import { logger } from '@bamboocss/logger'
import {
  BambooContext,
  analyze,
  artifactsToRebuild,
  buildInfo,
  codegen,
  cssgen,
  debug,
  doctor,
  formatDoctorReport,
  generate,
  generatePackageExports,
  loadConfigAndCreateContext,
  setLogStream,
  setupConfig,
  setupGitIgnore,
  spec,
  startProfiling,
  type CssGenOptions,
} from '@bamboocss/node'
import { BambooError, closestMatch, compact } from '@bamboocss/shared'
import type { Config, CssArtifactType } from '@bamboocss/types'
import { cac } from 'cac'
import { existsSync } from 'node:fs'
import { Console } from 'node:console'
import { join, resolve } from 'node:path'
import { version } from '../package.json'
import type {
  AnalyzeCommandFlags,
  DoctorCommandFlags,
  CodegenCommandFlags,
  CssGenCommandFlags,
  DebugCommandFlags,
  EmitPackageCommandFlags,
  InitCommandFlags,
  MainCommandFlags,
  McpInitCommandFlags,
  ShipCommandFlags,
  SpecCommandFlags,
} from './types'

/**
 * The negative spellings, answered here rather than left to cac, which only recognises
 * `--no-strict-values`. A user writing `--strict-values=false` means the same thing.
 *
 * Anything unrecognised is refused rather than coerced. Mapping the unknown to `true` is the
 * worst available answer: `--strict-values=false` would turn it *on*, and every raw CSS value in
 * the project would become a type error with nothing naming the mistake.
 */
const OFF = new Set(['false', 'no', 'off', '0', ''])

/**
 * `--strict-values` writes a *policy*, so nothing is written unless it is asked for.
 *
 * It used to default to the middle mode, because leaving it off meant `css({ color: 'mutedd' })`
 * type-checked, built, and shipped a declaration the browser discards. The build reports that
 * now — see `unresolvedToken` — so what is left here is the question this setting was always
 * really about: must every raw CSS value be written `'[14px]'`? That is a team's decision about
 * their design system, and a default cannot make it for them.
 */
const normalizeStrictTokens = (value: unknown): Config['strictValues'] | undefined => {
  if (value === undefined || value === false) return undefined
  if (value === true) return true
  const named = String(value)
  if (OFF.has(named)) return undefined
  if (named === 'true' || named === 'yes' || named === 'on') return true
  throw new BambooError(
    'CONFIG_ERROR',
    `\`--strict-values ${named}\` is not a setting. Pass it bare to require every value to be a token.`,
  )
}

/**
 * Refuse a word one slip from a command, and naming nothing on disk — `bamboo codgen`.
 *
 * The default command reads its arguments as `include` globs, so a mistyped command matched no
 * files, built a stylesheet from nothing over the real one, and exited 0. `generate` refuses any
 * glob matching nothing; this answers the one case it can say more about, the command meant.
 * Watching or not, as the typo is a typo either way. A word near no command — `bamboo deploy` —
 * is left to `generate`, which watching lets wait for the files to appear.
 */
const assertKnownCommand = (files: string[], cwd: string, commands: string[]) => {
  for (const file of files) {
    if (!/^[a-z][\w-]*$/i.test(file) || existsSync(resolve(cwd, file))) continue

    const suggestion = closestMatch(file.toLowerCase(), commands)
    if (!suggestion) continue

    throw new BambooError(
      'UNKNOWN_COMMAND',
      `\`bamboo ${file}\` is not a command; did you mean \`bamboo ${suggestion}\`?`,
      {
        hint: 'Run `bamboo --help` for the list of commands.',
      },
    )
  }
}

/**
 * A command's config overrides, with `logLevel: 'silent'` laid over them under `--silent`.
 *
 * Creating a context sets the level a config's `logLevel` names, after the command had quieted
 * the logger, which undid `--silent` for every project that names one. Laid over the config, it
 * is the level the context sets, and stays so when a watch reads the config again.
 */
function silenced<T extends Config>(config: T, silent: boolean | undefined): T
function silenced<T extends Config>(config: T | undefined, silent: boolean | undefined): T | undefined
function silenced<T extends Config>(config: T | undefined, silent: boolean | undefined) {
  return silent ? ({ ...config, logLevel: 'silent' } as T) : config
}

/**
 * Keep stdout to a command's output, as `bamboo mcp` keeps it to its protocol: the log, which the
 * logger writes through `console`, goes to stderr, and a reader that has gone — `bamboo analyze
 * --unused | head -1` — ends the command, rather than failing it with `EPIPE`.
 */
const keepStdoutToOutput = () => {
  const toStderr = new Console({ stdout: process.stderr, stderr: process.stderr })
  for (const method of ['log', 'info', 'debug', 'dir'] as const) console[method] = toStderr[method].bind(toStderr)
  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED') process.exit(0)
    throw error
  })
}

export async function main() {
  const cli = cac('bamboo')

  const cwd = process.cwd()

  cli
    .command('init', 'Initialize the bamboo config file')
    .option('-i, --interactive', 'Run in interactive mode', { default: false })
    .option('-f, --force', 'Force overwrite existing config file')
    .option('-c, --config <path>', 'Path to bamboo config file')
    .option('--cwd <cwd>', 'Current working directory', { default: cwd })
    .option('--silent', 'Suppress all messages except errors')
    .option('--no-gitignore', "Don't update the .gitignore")
    .option('--no-codegen', "Don't run the codegen logic")
    .option('--out-extension <ext>', "The extension of the generated js files (default: 'mjs')")
    .option('--outdir <dir>', 'The output directory for the generated files')
    .option('--strict-values [mode]', 'Require every style value to be a token, so a raw css value is written `[14px]`')
    .option('--logfile <file>', 'Outputs logs to a file')
    .action(async (initFlags: Partial<InitCommandFlags> = {}) => {
      // Typed rather than `{}`. Widening the interactive result to an empty object is what let
      // its `strictValues` answer be returned, declared, and never read by the destructuring
      // below — the field was invisible to the type system at exactly the point that mattered.
      let options: Partial<InitCommandFlags> = {}

      if (initFlags.interactive) {
        // Imported here so `@clack/prompts` stays out of every non-interactive run. `init -i` is
        // the only path that prompts, and this entry is bundled — a static import put the whole
        // prompt library in the chunk that `codegen` and the default build command parse.
        const { interactive } = await import('./interactive')
        options = await interactive({ cwd: resolve(initFlags.cwd ?? '') })
      }

      const flags = { ...initFlags, ...options }

      const { force, silent, gitignore, outExtension, strictValues, config: configPath } = flags

      const cwd = resolve(flags.cwd ?? '')

      if (silent) {
        logger.level = 'silent'
      }

      const stream = setLogStream({ cwd, logfile: flags.logfile })

      logger.info('cli', `Bamboo v${version}\n`)

      const done = logger.time.info('✨ Bamboo initialized')

      await setupConfig(
        cwd,
        compact({
          force,
          outExtension,
          outdir: flags.outdir,
          // Both `--strict-values` and the interactive answer used to stop here: the value was
          // collected, never destructured, and never written — so a project that asked for
          // strict tokens got a config without them and nothing said so.
          strictValues: normalizeStrictTokens(strictValues),
        }),
      )

      const ctx = await loadConfigAndCreateContext({
        cwd,
        configPath,
        config: silenced(compact({ gitignore, outdir: flags.outdir }), silent),
      })

      if (gitignore) {
        setupGitIgnore(ctx)
      }

      if (flags.codegen) {
        const { msg, box } = await codegen(ctx)
        logger.log(msg + box)
      } else {
        logger.log(ctx.initMessage())
      }

      done()

      stream.end()
    })

  cli
    .command('codegen', 'Generate the bamboo system')
    .option('--silent', "Don't print any logs")
    .option('--clean', 'Clean the output directory before generating')
    .option('-c, --config <path>', 'Path to bamboo config file')
    .option('-w, --watch', 'Watch files and rebuild')
    .option('-p, --poll', 'Use polling instead of filesystem events when watching')
    .option('--cwd <cwd>', 'Current working directory', { default: cwd })
    .option('--cpu-prof', 'Generates a `.cpuprofile` to help debug performance issues')
    .option('--logfile <file>', 'Outputs logs to a file')
    .action(async (flags: CodegenCommandFlags) => {
      const { silent, clean, config: configPath, watch, poll } = flags

      const cwd = resolve(flags.cwd ?? '')

      const stream = setLogStream({ cwd, logfile: flags.logfile })

      let stopProfiling: Function = () => void 0
      if (flags.cpuProf) {
        stopProfiling = await startProfiling(cwd, 'codegen', flags.watch)
      }

      if (silent) {
        logger.level = 'silent'
      }

      let ctx = await loadConfigAndCreateContext({
        cwd,
        // Only when it was passed: an absent `--clean` is not `clean: undefined` over the config's.
        config: silenced(compact({ clean }), silent),
        configPath,
      })

      const { msg } = await codegen(ctx)
      logger.log(msg)

      if (watch) {
        ctx.watchConfig(
          async (_file, reloaded) => {
            const affecteds = await ctx.diff.reloadConfigAndRefreshContext((conf) => {
              ctx = new BambooContext(conf)
            })
            reloaded(ctx)

            await ctx.hooks['config:change']?.({ config: ctx.config, changes: affecteds })
            await codegen(ctx, artifactsToRebuild(affecteds))
            logger.info('ctx:updated', 'config rebuilt ✅')
            return ctx
          },
          { cwd, poll },
        )
      } else {
        stream.end()
      }

      stopProfiling()
    })

  cli
    .command(
      'cssgen [...globsOrType]',
      'Generate the css from files, or generate the css from the specified type which can be: preflight, tokens, static, global, keyframes',
    )
    .option('--silent', "Don't print any logs")
    .option('-m, --minify', 'Minify generated code')
    .option('--clean', 'Clean the output before generating')
    .option('-c, --config <path>', 'Path to bamboo config file')
    .option('-w, --watch', 'Watch files and rebuild')
    .option('-p, --poll', 'Use polling instead of filesystem events when watching')
    .option('-o, --outfile [file]', "Output file for extracted css, default to './styled-system/styles.css'")
    .option('--splitting', 'Emit CSS as separate files per layer (reset, global, tokens, utilities)')
    .option('--cwd <cwd>', 'Current working directory', { default: cwd })
    .option('--cpu-prof', 'Generates a `.cpuprofile` to help debug performance issues')
    .option('--logfile <file>', 'Outputs logs to a file')
    .action(async (globsOrType: string[], flags: CssGenCommandFlags = {}) => {
      const { silent, config: configPath, outfile, watch, poll, splitting, ...rest } = flags

      const cwd = resolve(flags.cwd ?? '')
      const stream = setLogStream({ cwd, logfile: flags.logfile })

      let stopProfiling: Function = () => void 0
      if (flags.cpuProf) {
        stopProfiling = await startProfiling(cwd, 'cssgen', flags.watch)
      }

      const cssArtifact = ['preflight', 'tokens', 'static', 'global', 'keyframes'].find(
        (type) => type === globsOrType[0],
      ) as CssArtifactType | undefined
      if (cssArtifact && globsOrType.length > 1) {
        throw new BambooError(
          'INVALID_ARGUMENT',
          `\`cssgen ${cssArtifact}\` writes that part of the css alone, and takes no globs: ${globsOrType.slice(1).join(', ')}.`,
        )
      }

      // Every word, as the main command takes them: one glob read the first file of a list the shell
      // expanded, or of several written out, and dropped the rest without a word.
      const globs = cssArtifact ? [] : globsOrType

      if (silent) {
        logger.level = 'silent'
      }

      const overrideConfig = {
        ...rest,
        ...(globs.length ? { include: globs } : undefined),
      }

      let ctx = await loadConfigAndCreateContext({
        cwd,
        config: silenced(overrideConfig, silent),
        configPath,
      })

      const options: CssGenOptions = {
        cwd,
        outfile,
        type: cssArtifact,
        splitting,
      }

      await cssgen(ctx, options)

      if (watch) {
        //
        ctx.watchConfig(
          async (_file, reloaded) => {
            const affecteds = await ctx.diff.reloadConfigAndRefreshContext((conf) => {
              ctx = new BambooContext(conf)
            })
            reloaded(ctx)

            await ctx.hooks['config:change']?.({ config: ctx.config, changes: affecteds })
            await cssgen(ctx, options)
            logger.info('ctx:updated', 'config rebuilt ✅')
            return ctx
          },
          { cwd, poll },
        )

        ctx.watchFiles(async (event, file) => {
          const filePath = ctx.runtime.path.abs(cwd, file)
          if (event === 'unlink') {
            ctx.project.removeSourceFile(filePath)
            ctx.forgetNativeFile(filePath)
            await cssgen(ctx, options)
          } else if (event === 'change' || event === 'add') {
            ctx.project.reloadSourceFile(filePath)
            await cssgen(ctx, options)
          }
        })
      } else {
        stream.end()
        stopProfiling()
      }
    })

  cli
    // Every word, for a glob the shell expanded: `[files]` took the first file of `src/*.tsx`
    // and built the stylesheet from it alone, dropping the rest without a word.
    .command('[...files]', 'Include file globs', { ignoreOptionDefaultValue: true })
    .option('-o, --outdir <dir>', 'Output directory', { default: 'styled-system' })
    .option('-m, --minify', 'Minify generated code')
    .option('-w, --watch', 'Watch files and rebuild')
    .option('-p, --poll', 'Use polling instead of filesystem events when watching')
    .option('-c, --config <path>', 'Path to bamboo config file')
    .option('--cwd <cwd>', 'Current working directory', { default: cwd })
    .option('--preflight', 'Enable css reset')
    .option('--silent', 'Suppress all messages except errors')
    .option('-e, --exclude <files>', 'Exclude files', { default: [] })
    .option('--clean', 'Clean output directory')
    .option('--hash', 'Hash the generated classnames to make them shorter')
    .option('--emitTokensOnly', 'Whether to only emit the `tokens` directory')
    .option('--cpu-prof', 'Generates a `.cpuprofile` to help debug performance issues')
    .option('--logfile <file>', 'Outputs logs to a file')
    .action(async (files: string[], flags: MainCommandFlags) => {
      const { config: configPath, silent, ...rest } = flags

      const cwd = resolve(flags.cwd ?? '')
      const commands = cli.commands.map((command) => command.name).filter(Boolean)
      assertKnownCommand(files, cwd, commands)

      const stream = setLogStream({ cwd, logfile: flags.logfile })

      let stopProfiling: Function = () => void 0
      if (flags.cpuProf) {
        stopProfiling = await startProfiling(cwd, 'cli', flags.watch)
      }

      if (silent) {
        logger.level = 'silent'
      }

      // One `-e` is a string, several an array: `cac` makes a list only of a flag given twice.
      const exclude = rest.exclude == null ? undefined : [rest.exclude].flat().map(String)
      const config = compact({ include: files.length ? files : undefined, ...rest, exclude, cwd })
      await generate(silenced(config, silent), configPath, { requireFiles: files.length > 0 })

      stopProfiling()

      if (!flags.watch) {
        stream.end()
      }
    })

  cli
    .command('spec', 'Generate spec files for your theme (useful for documentation)')
    .option('--silent', "Don't print any logs")
    .option('--outdir <dir>', 'Output directory for spec files')
    .option('-c, --config <path>', 'Path to bamboo config file')
    .option('--cwd <cwd>', 'Current working directory', { default: cwd })
    .action(async (flags: SpecCommandFlags) => {
      const { silent, config: configPath, outdir } = flags
      const cwd = resolve(flags.cwd ?? '')

      if (silent) {
        logger.level = 'silent'
      }

      const ctx = await loadConfigAndCreateContext({
        cwd,
        configPath,
        config: silenced({ cwd }, silent),
      })

      await spec(ctx, { outdir })
    })

  cli
    .command('analyze [...globs]', 'Analyze design token usage in globs')
    .option('--outfile [filepath]', 'Output analyze report in JSON')
    .option('--silent', "Don't print any logs")
    .option('--scope <type>', 'Select analysis scope: token or recipe, and with --unused pattern or keyframe')
    .option('--unused', 'List only the configured names no source uses, one per line')
    .option('-c, --config <path>', 'Path to bamboo config file')
    .option('--cwd <cwd>', 'Current working directory', { default: cwd })
    .action(async (globs: string[], flags: AnalyzeCommandFlags = {}) => {
      const { silent, config: configPath } = flags
      const scope = flags.scope?.replace(/s$/, '')
      if (scope != null && !['token', 'recipe', 'pattern', 'keyframe'].includes(scope)) {
        throw new BambooError(
          'INVALID_FLAG',
          `--scope is one of token, recipe, pattern or keyframe, not "${flags.scope}".`,
        )
      }
      if (!flags.unused && (scope === 'pattern' || scope === 'keyframe')) {
        throw new BambooError('INVALID_FLAG', `--scope ${scope} lists what is unused, with --unused.`)
      }

      const tokenScope = scope == null || scope === 'token'
      const recipeScope = scope == null || scope === 'recipe'

      const cwd = resolve(flags.cwd!)

      if (silent) logger.level = 'silent'
      const outfile = typeof flags.outfile === 'string' ? resolve(flags.outfile) : undefined

      // The list is the output, on stdout, where the logger writes too: a log line there would be
      // read as a name.
      if (flags.unused && !outfile) keepStdoutToOutput()

      const ctx = await loadConfigAndCreateContext({
        cwd,
        config: silenced(compact({ include: globs.length ? globs : undefined }), silent),
        configPath,
      })

      const result = await analyze(ctx)

      // One name to a line, on stdout, so a script can read it: under a scope the bare names,
      // and otherwise each after what it is.
      if (flags.unused) {
        const keys = { token: 'tokens', recipe: 'recipes', pattern: 'patterns', keyframe: 'keyframes' } as const
        const scoped = scope ? keys[scope as keyof typeof keys] : undefined
        const unused = result.getUnused(scoped ? [scoped] : undefined)
        if (outfile) {
          await result.writeUnused(outfile, scoped ? { [scoped]: unused[scoped] } : unused)
          logger.info('cli', `JSON report saved to ${outfile}`)
          return
        }
        const lines = Object.entries(keys).flatMap(([kind, key]) =>
          scoped == null ? unused[key].map((name) => `${kind} ${name}`) : key === scoped ? unused[key] : [],
        )
        if (lines.length) process.stdout.write(lines.join('\n') + '\n')
        return
      }

      if (flags?.outfile && typeof flags.outfile === 'string') {
        await result.writeReport(flags.outfile)
        logger.info('cli', `JSON report saved to ${resolve(flags.outfile)}`)
        return
      }

      if (tokenScope) {
        if (!ctx.tokens.isEmpty) {
          const tokenAnalysis = result.getTokenReport()
          logger.info('analyze:tokens', `Token usage report 🎨 \n${tokenAnalysis.formatted}`)
        } else {
          logger.info('analyze:tokens', 'No tokens found')
        }
      }

      if (recipeScope) {
        if (!ctx.recipes.isEmpty()) {
          const recipeAnalysis = result.getRecipeReport()
          logger.info('analyze:recipes', `Config recipes usage report 🎛️ \n${recipeAnalysis.formatted}`)
        } else {
          logger.info('analyze:recipes', 'No config recipes found')
        }
      }
    })

  cli
    .command('doctor', 'Check the project as the build reads it: its config, sources and generated files')
    .option('--json', 'Print the report as JSON')
    .option('-c, --config <path>', 'Path to bamboo config file')
    .option('--cwd <cwd>', 'Current working directory', { default: cwd })
    .action(async (flags: DoctorCommandFlags = {}) => {
      const cwd = resolve(flags.cwd!)

      // The report is the output, and under `--json` a log line in it would not parse.
      if (flags.json) keepStdoutToOutput()

      const ctx = await loadConfigAndCreateContext({ cwd, configPath: flags.config })
      const report = await doctor(ctx)

      process.stdout.write((flags.json ? JSON.stringify(report, null, 2) : formatDoctorReport(report)) + '\n')
      if (report.problems.length) process.exitCode = 1
    })

  cli
    .command('debug [...globs]', 'Debug design token extraction & css generated from files in globs')
    .option('--silent', "Don't print any logs")
    .option('--dry', 'Output debug files in stdout without writing to disk')
    .option('--outdir [dir]', "Output directory for debug files, default to './styled-system/debug'")
    .option('--only-config', "Should only output the config file, default to 'false'")
    .option('--zip', 'Write the debug files as one <outdir>.zip, to attach to a bug report')
    .option('-c, --config <path>', 'Path to bamboo config file')
    .option('--cwd <cwd>', 'Current working directory', { default: cwd })
    .option('--cpu-prof', 'Generates a `.cpuprofile` to help debug performance issues')
    .option('--logfile <file>', 'Outputs logs to a file')
    .action(async (globs: string[], flags: DebugCommandFlags = {}) => {
      const { silent, dry = false, outdir: outdirFlag, config: configPath } = flags ?? {}
      if (dry && flags.zip) throw new BambooError('INVALID_FLAG', '--zip writes an archive, and --dry writes nothing.')

      const cwd = resolve(flags.cwd!)
      const stream = setLogStream({ cwd, logfile: flags.logfile })

      let stopProfiling: Function = () => void 0
      if (flags.cpuProf) {
        stopProfiling = await startProfiling(cwd, 'debug')
      }

      if (silent) {
        logger.level = 'silent'
      }

      const ctx = await loadConfigAndCreateContext({
        cwd,
        config: silenced(globs.length ? { include: globs } : undefined, silent),
        configPath,
      })

      // `--outdir` with no folder names none.
      const outdir = typeof outdirFlag === 'string' ? outdirFlag : join(...ctx.paths.root, 'debug')

      await debug(ctx, { outdir, dry, onlyConfig: flags.onlyConfig, zip: flags.zip })

      stopProfiling()
      stream.end()
    })

  cli
    .command('ship [...globs]', 'Ship extract result from files in globs')
    .option('--silent', "Don't print any logs")
    .option(
      '--o, --outfile [file]',
      "Output path for the build info file, default to './styled-system/bamboo.buildinfo.json'",
    )
    .option('-m, --minify', 'Minify generated JSON file')
    .option('-c, --config <path>', 'Path to bamboo config file')
    .option('--cwd <cwd>', 'Current working directory', { default: cwd })
    .option('-w, --watch', 'Watch files and rebuild')
    .option('-p, --poll', 'Use polling instead of filesystem events when watching')
    .action(async (globs: string[], flags: ShipCommandFlags = {}) => {
      const { silent, outfile: outfileFlag, minify, config: configPath, watch, poll } = flags

      const cwd = resolve(flags.cwd!)

      if (silent) {
        logger.level = 'silent'
      }

      // Laid over the config, rather than set on the context, so a config read again keeps it.
      let ctx = await loadConfigAndCreateContext({
        cwd,
        config: silenced(compact({ include: globs.length ? globs : undefined, minify }), silent),
        configPath,
      })

      const outfile = outfileFlag ?? join(...ctx.paths.root, 'bamboo.buildinfo.json')

      await buildInfo(ctx, outfile)

      if (watch) {
        ctx.watchConfig(
          async (_file, reloaded) => {
            const affecteds = await ctx.diff.reloadConfigAndRefreshContext((conf) => {
              ctx = new BambooContext(conf)
            })
            reloaded(ctx)

            await ctx.hooks['config:change']?.({ config: ctx.config, changes: affecteds })
            await buildInfo(ctx, outfile)
            logger.info('ctx:updated', 'config rebuilt ✅')
            return ctx
          },
          { cwd, poll },
        )

        ctx.watchFiles(async (event, file) => {
          const filePath = ctx.runtime.path.abs(cwd, file)
          if (event === 'unlink') {
            ctx.project.removeSourceFile(filePath)
            ctx.forgetNativeFile(filePath)
          } else if (event === 'change' || event === 'add') {
            ctx.project.reloadSourceFile(filePath)
            await buildInfo(ctx, outfile)
          }
        })
      }
    })

  cli
    .command('emit-pkg', 'Emit package.json with entrypoints')
    .option('--outdir <dir>', 'Output directory', { default: '.' })
    .option('--base <source>', 'The base directory of the package.json entrypoints')
    .option('--silent', "Don't print any logs")
    .option('--cwd <cwd>', 'Current working directory', { default: cwd })
    .action(async (flags: EmitPackageCommandFlags) => {
      const { outdir, silent, base } = flags

      if (silent) {
        logger.level = 'silent'
      }

      const cwd = resolve(flags.cwd!)

      const ctx = await loadConfigAndCreateContext({
        cwd,
        config: silenced({ cwd }, silent),
      })

      const pkgPath = resolve(cwd, outdir, 'package.json')
      const exists = ctx.runtime.fs.existsSync(pkgPath)

      /**
       * The same map codegen writes into the outdir, re-derived here with the package's
       * `base` prefix. Shared rather than restated so the entry list has one definition —
       * this copy had drifted: it advertised a `require` condition pointing at `.mjs`, for
       * output that is ESM under every setting, and it listed `./types` as a runtime entry
       * for a directory holding only declarations.
       */
      const generated = generatePackageExports(ctx, base)

      const identity = {
        name: outdir,
        description: 'This package is auto-generated by Bamboo CSS',
        version: '0.1.0',
        type: 'module',
        keywords: ['bamboocss', 'styled-system', 'codegen'],
        license: 'ISC',
        scripts: {
          prepare: 'bamboo codegen --clean',
        },
      }

      const existing = exists ? JSON.parse(ctx.runtime.fs.readFileSync(pkgPath)) : {}

      /**
       * Codegen writes a package.json of its own into the outdir so that bundlers get a
       * `sideEffects` hint, and marks it `private` because a generated directory is not
       * something to publish. This command is what turns it into a real package: it
       * supplies the identity the file lacks and lifts that flag.
       *
       * This used to key on a missing `name`. Codegen now emits one — a nameless
       * package.json is what pnpm, npm and changesets refuse to scan rather than skip —
       * so its absence no longer distinguishes anything.
       *
       * `private` alone will not do either: a consumer can own a private *named* package
       * here, which is the `@acme/styled-system` workspace layout the component-library
       * guide recommends. What separates the two is `version`. Ours never carries one, and
       * a file that is private with no version is by definition not publishable and holds
       * no identity worth preserving, so supplying one is the whole point of the command.
       *
       * `existing` is spread last, so anything already declared wins and a second run
       * only refreshes `exports`.
       */
      const isGenerated = existing.private === true && existing.version === undefined
      const content = isGenerated ? { ...identity, ...existing } : existing
      if (isGenerated) delete content.private

      content.exports = {
        ...content.exports,
        ...generated,
      }

      await ctx.runtime.fs.writeFile(pkgPath, JSON.stringify(content, null, 2) + '\n')

      logger.info('cli', `Emit package.json to ${pkgPath}`)
    })

  cli
    .command('mcp', 'Moved to the standalone @bamboocss/mcp package')
    .option('-c, --config <path>', 'Path to bamboo config file')
    .option('--cwd <cwd>', 'Current working directory', { default: cwd })
    .action(() => {
      // Kept as a command rather than deleted so the configs written before the move fail with
      // this instead of cac's "unknown command".
      //
      // Written to stderr directly rather than through the logger, which prints to stdout. A
      // stale config invokes this *as the server*, where stdout is the protocol channel the
      // client parses and discards, and stderr is what it surfaces in its logs.
      process.stderr.write(
        [
          'The MCP server now ships as its own package, so installing Bamboo no longer pulls in',
          'the Model Context Protocol SDK and its HTTP server dependencies.',
          '',
          'Run `bamboo init-mcp` to rewrite your client config, or start it directly with:',
          '',
          `  npx -y @bamboocss/mcp@${version}`,
          '',
        ].join('\n'),
      )
      process.exitCode = 1
    })

  cli
    .command('init-mcp', 'Initialize MCP configuration for AI clients')
    .option('--cwd <cwd>', 'Current working directory', { default: cwd })
    .option('--client <clients>', 'AI clients to configure (claude, cursor, vscode, windsurf, codex)')
    .action(async (mcpInitFlags: McpInitCommandFlags) => {
      const { initMcpConfig } = await import('./mcp-init')
      const resolvedCwd = resolve(mcpInitFlags.cwd ?? cwd)

      // Parse comma-separated clients if provided
      let clients: string[] | undefined
      if (mcpInitFlags.client) {
        clients = (Array.isArray(mcpInitFlags.client) ? mcpInitFlags.client : [mcpInitFlags.client])
          .flatMap((c) => c.split(','))
          .map((c) => c.trim())
      }

      await initMcpConfig({ cwd: resolvedCwd, clients: clients as any })
    })

  cli.help()

  cli.version(version)

  cli.parse(process.argv, { run: false })
  await cli.runMatchedCommand()
}
