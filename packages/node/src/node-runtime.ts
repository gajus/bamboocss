import { logger } from '@bamboocss/logger'
import type { Runtime } from '@bamboocss/types'
import chokidar from 'chokidar'
import glob from 'fast-glob'
import fsExtra from 'fs-extra'
import { type Dirent, readdirSync, realpathSync, statSync, type Stats, type StatSyncOptions } from 'node:fs'
import { dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import picomatch from 'picomatch'
import { globDirname } from './glob-dirname'

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
export const globIgnore = (exclude: string[] | undefined) => ['**/*.d.ts', ...(exclude ?? [])]

/** Patterns that name what to read, apart from those, `!`-led, that name what to pass over. */
export const splitPatterns = (patterns: readonly string[]) => {
  const positive: string[] = []
  const negative: string[] = []
  for (const pattern of patterns) {
    if (picomatch.scan(pattern).negated) negative.push(pattern.slice(1))
    else positive.push(pattern)
  }
  return { negative, positive }
}

/**
 * Whether a `cwd`-relative, `/`-spelled path is one the source glob returns for `include` and
 * `exclude`, told without walking: what decides a file's membership when it appears, and whether
 * the compiler reads a module.
 *
 * As the glob reads the two, which a matcher handed the same lists does not:
 *
 * - A negated `include` pattern — `!src/legacy/**` — is one more thing to pass over, where such a
 *   matcher matches every path it does not name: `README.md`, and each module in `node_modules`,
 *   was a source. So is a negated `exclude` pattern, which the glob reads without its `!`.
 * - A file passed over is matched with hidden paths in reach, so `**\/*.d.ts` drops one under
 *   `.storybook` that `include` names, though a wildcard of `include`'s own does not enter it.
 * - A folder the walk meets below where it began, with a name an ignore matches outright —
 *   `src/legacy`, `**\/legacy`, not `src/legacy/*` — is not read: nothing in it is a source. The
 *   folder a walk begins at is never tested, so `src/legacy/**` beside `exclude: ['src/legacy']`
 *   reads it, and a pattern without a glob — looked up in its own folder — is one wherever it is.
 * - A pattern is matched as its own walk spells what it meets: one written as an absolute path
 *   against where a file is from the root, and every other against where it is from `cwd` — so
 *   `**\/*.tsx` reaches nothing above `cwd`, and an absolute `exclude` beside a relative `include`
 *   passes over nothing, as the glob passes over nothing for it.
 */
export const sourceMatcher = (
  include: readonly string[] = [],
  exclude?: string[],
  cwd: string = process.cwd(),
): ((path: string) => boolean) => {
  const { negative, positive } = splitPatterns(include)
  // As written: the glob resolves `..` in what it reads from, not in what it passes over.
  const ignore = [
    ...negative,
    ...globIgnore(exclude).map((pattern) => (pattern.startsWith('!') ? pattern.slice(1) : pattern)),
  ]
  const read = positive.map(resolveDots)
  // Each walk matches what it meets as its own patterns spell it: from `cwd`, or from the root.
  const fromCwd = membership(
    read.filter((pattern) => !isAbsolute(pattern)),
    ignore,
    cwd,
  )
  const absolute = read.filter((pattern) => isAbsolute(pattern))
  // Spelled with `/`, as the glob spells it: a watcher on Windows hands over `\`.
  const spelled = (input: string) => (input.includes('\\') ? slashes(input) : input)
  if (!absolute.length) return (input) => fromCwd(spelled(input))
  const fromRoot = membership(absolute, ignore, cwd)
  const root = slashes(cwd)
  return (input) => {
    const path = spelled(input)
    return fromCwd(path) || fromRoot(posix.join(root, path))
  }
}

/** A pattern with `.` and `..` segments resolved, as the walk resolves them on its way down. */
const resolveDots = (pattern: string) =>
  pattern.startsWith('./') || pattern.includes('/./') || pattern.includes('/../') ? posix.normalize(pattern) : pattern

/** As `sourceMatcher` tells it, for patterns all spelled the one way — and paths spelled so. */
const membership = (read: string[], ignore: string[], cwd: string): ((path: string) => boolean) => {
  if (!read.length) return () => false
  // `/` in a path and `\` an escape, on every platform, as the glob reads them.
  const options = { windows: false }
  // As written — braces and all, one test each — and what is passed over only once that matches,
  // so a module no pattern reaches costs no more than the patterns.
  const matches = picomatch(read, options)
  const ignored = picomatch(ignore, { ...options, dot: true })
  const member = (path: string) => matches(path) && !ignored(path)

  // Those that stop the walk at a folder: a name without a glob, which it tests a folder against
  // — with its own reading of a hidden name, unlike what it tests a file against.
  const folderIgnore = ignore.filter(
    (pattern) => !pattern.endsWith('/**') && !glob.isDynamicPattern(posix.basename(pattern)),
  )
  if (!folderIgnore.length) return member

  // By the folder each is read from — a pattern without a glob too, which is looked up in its own
  // folder, so that nothing lies between where it is read from and the file.
  const walks = byWalk(
    glob.generateTasks(read, { cwd }).flatMap((task) => task.positive),
    cwd,
  )
  let stops = false
  const reads = [...walks].map(([base, patterns]) => {
    // With one walk, the patterns as written already said that it reaches the path.
    const inWalk = walks.size === 1 ? () => true : picomatch(patterns, options)
    // Not the folder a walk begins at, nor one above it: the walk never tests those.
    const skipped = folderIgnore.filter((pattern) => !picomatch([pattern, `${pattern}/**`], options)(base))
    if (!skipped.length) return inWalk
    stops = true
    const inSkipped = picomatch(
      skipped.map((pattern) => `${pattern}/**`),
      options,
    )
    return (path: string) => inWalk(path) && !inSkipped(path)
  })
  // Read by some walk that reaches it, and was not stopped short of it.
  return stops ? (path) => member(path) && reads.some((read) => read(path)) : member
}

/** Patterns by the folder each is walked from when alone, as the source glob walks them. */
const byWalk = (patterns: readonly string[], cwd: string | undefined) => {
  const walks = new Map<string, string[]>()
  for (const pattern of patterns) {
    const base = glob.generateTasks([pattern], { cwd })[0]?.base ?? '.'
    walks.set(base, [...(walks.get(base) ?? []), pattern])
  }
  return walks
}

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
export const sortSources = (files: string[]) => files.sort()

const slashes = (path: string) => path.replaceAll('\\', '/')

/**
 * A folder's entry, joined as the walk joins it — onto the path it read, with `/` unless that path
 * ends in one already — and spelled as every path here is, with `/`.
 */
const entryPath = (directory: string, name: string) =>
  slashes(directory.endsWith('/') ? directory + name : `${directory}/${name}`)

/** Where a folder really is, or as spelled if the system cannot say. */
const realOf = (directory: string) => {
  try {
    return slashes(realpathSync.native(directory))
  } catch {
    return directory
  }
}

/** `entries` as `readdirSync` hands them over, named alone unless asked for their types. */
const answer = (entries: Dirent[], options?: { withFileTypes?: boolean }) =>
  options?.withFileTypes ? entries : entries.map((entry) => entry.name)

/**
 * One walk of the source glob, which enters each real folder once.
 *
 * The glob follows symbolic links — how a workspace package or a folder linked into `src` is read
 * at all — and it followed every path through them. A link back into a folder the walk was inside
 * took it round again, until the system would resolve no deeper a chain of links; and in a pnpm
 * workspace, where each package's `node_modules` links its siblings, an include reaching each
 * package's `src` through `../**` went through every sequence of them: 13,699 paths to 7 files, and
 * 109,600 and a minute for 8. Extraction read each real file once, so what came of the walk was its
 * time, and a watch on every path.
 *
 * So each real folder is entered once. The plain ones first: the walk reads no link, and sets aside
 * each one it would enter, so a file it can reach directly is found where it really is. Then each
 * link set aside, in order of its path and round by round as links within them turn up: one leading
 * to a folder entered already is read as empty, as `find -L` reads a loop, and one leading anywhere
 * else is walked, through the folders above it and nothing else of them. A link to a file is a file,
 * and found as before.
 *
 * What that gives up is a second spelling of one folder: two links in one walk to a folder outside
 * it find it by the first. Patterns walked apart, `src/**` and `vendor/**`, still find it by each.
 *
 * `linked` is where the walk began, and each folder and file it reached through a link, as it spelled
 * them: where a path it found may really be elsewhere.
 */
const globEachFolderOnce = (patterns: string[], cwd: string | undefined) => {
  /** Every entry listed that is a symbolic link, by its path. */
  const links = new Set<string>()
  /** Every entry listed as a link that is one to a file. */
  const fileLinks = new Set<string>()
  /** Every real folder entered. */
  const entered = new Set<string>()
  /** Links to folders the walk would have entered, to look at once the folders before them are read. */
  let aside: string[] = []
  const linked: string[] = []

  const list = (directory: string) => {
    const entries = readdirSync(directory, { withFileTypes: true })
    for (const entry of entries) if (entry.isSymbolicLink()) links.add(entryPath(directory, entry.name))
    return entries
  }

  const stat = ((path: string, options?: StatSyncOptions) => {
    const stats = statSync(path, options)
    const key = slashes(String(path))
    if (stats && links.has(key) && (stats as Stats).isFile()) fileLinks.add(key)
    return stats
  }) as typeof statSync

  // The plain folders, from the one the walk begins at: always the first it reads.
  let root: string | undefined
  let rootReal = ''
  const plain = ((path: string, options?: { withFileTypes?: boolean }) => {
    const directory = slashes(String(path))
    if (root === undefined) {
      root = directory
      rootReal = realOf(directory)
      linked.push(directory)
    } else if (links.has(directory)) {
      aside.push(directory)
      return []
    }
    // Reached through no link, so it is where the walk began is, and below it as spelled.
    entered.add(rootReal + directory.slice(root.length))
    return answer(list(directory), options)
  }) as unknown as typeof readdirSync

  const found = [glob.sync(patterns, { absolute: true, cwd, fs: { readdirSync: plain, statSync: stat } })]

  while (aside.length) {
    const round = [...new Set(aside)].sort()
    aside = []
    for (const link of round) {
      const real = realOf(link)
      if (entered.has(real)) {
        logger.debug('glob', `${link} leads to ${real}, which is read already`)
        continue
      }
      const inside = `${link}/`
      const through = ((path: string, options?: { withFileTypes?: boolean }) => {
        const directory = slashes(String(path))
        if (directory === link || directory.startsWith(inside)) {
          if (directory !== link && links.has(directory)) {
            aside.push(directory)
            return []
          }
          // A link within is set aside, so the way here from the link is through plain folders.
          const folder = real + directory.slice(link.length)
          if (entered.has(folder)) return []
          entered.add(folder)
          if (directory === link) linked.push(link)
          return answer(list(directory), options)
        }
        // Above the link: only the way down to it, so nothing the walk found already is found again.
        const above = directory.endsWith('/') ? directory : `${directory}/`
        if (!link.startsWith(above)) return []
        const next = link.slice(above.length).split('/', 1)[0]
        return answer(
          readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.name === next),
          options,
        )
      }) as unknown as typeof readdirSync
      found.push(glob.sync(patterns, { absolute: true, cwd, fs: { readdirSync: through, statSync: stat } }))
    }
  }

  return { found: found.length === 1 ? found[0]! : found.flat(), linked: [...linked, ...fileLinks] }
}

/**
 * A task's patterns, by the folder each is walked from when it is alone.
 *
 * `fast-glob` walks every pattern inside `cwd` from `.` once any of them starts there, which saves
 * reading folders twice — and would make where a loop closes, and so what a pattern behind a link
 * matches, hang on its neighbours: `src/a/loop/**` matches through `src/a/loop` when walked from
 * there, and nothing once `*.css` beside it has the walk start at `.` and meet `src` first.
 */
const byOwnBase = (task: glob.Task, cwd: string | undefined) => {
  if (task.base !== '.' || task.positive.length < 2) return [task.positive]
  return [...byWalk(task.positive, cwd).values()]
}

export const nodeRuntime: Runtime = {
  cwd() {
    return process.cwd()
  },
  env(name: string) {
    return process.env[name]
  },
  path: {
    join,
    relative,
    dirname,
    extname,
    isAbsolute,
    sep,
    resolve,
    abs(cwd: string, str: string) {
      return isAbsolute(str) ? str : join(cwd, str)
    },
  },
  fs: {
    existsSync: fsExtra.existsSync,
    readFileSync(filePath: string) {
      return fsExtra.readFileSync(filePath, 'utf8')
    },
    glob(opts) {
      if (!opts.include) return []

      // One walk per folder a pattern starts from, each watched on its own and given the negatives
      // once — they come back in every task, `ignore` among them.
      const { cwd } = opts
      const walks: string[][] = []
      for (const task of glob.generateTasks(opts.include, { cwd, ignore: globIgnore(opts.exclude) })) {
        const negatives = task.negative.map((pattern) => `!${pattern}`)
        for (const patterns of byOwnBase(task, cwd)) {
          const walk = globEachFolderOnce([...patterns, ...negatives], cwd)
          walks.push(walk.found)
          // A pattern without a glob is looked up, not walked: what it found is all there is to tell,
          // and may be a link, or under one.
          opts.linked?.push(...walk.linked, ...(task.dynamic ? [] : walk.found))
        }
      }
      const files = sortSources(walks.length === 1 ? walks[0]! : walks.flat())
      // A path two walks both reach — `src/**` and `src/ui/**` — once, as `fast-glob` gives it; sorted
      // already, so a repeat sits beside its first.
      return walks.length > 1 ? files.filter((file, index) => index === 0 || file !== files[index - 1]) : files
    },
    writeFile: fsExtra.writeFile,
    writeFileSync: fsExtra.writeFileSync,
    readDirSync: fsExtra.readdirSync,
    isDirSync(path: string) {
      // `statSync` throws on a path that is not there, and every caller here would answer
      // that the same way.
      return fsExtra.statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false
    },
    rmDirSync: fsExtra.emptyDirSync,
    rmFileSync: fsExtra.removeSync,
    ensureDirSync(path: string) {
      return fsExtra.ensureDirSync(path)
    },
    watch(options) {
      const { include, exclude, cwd, poll } = options
      const coalesce = poll || process.platform === 'win32'

      const dirnames = globDirname(include)
      const workingDir = cwd || process.cwd()
      const isValidPath = sourceMatcher(include, exclude, workingDir)

      const watcher = chokidar.watch(dirnames, {
        usePolling: poll,
        cwd,
        ignored(path, stats) {
          const relativePath = relative(workingDir, path)
          return !!stats?.isFile() && !isValidPath(relativePath)
        },
        ignoreInitial: true,
        ignorePermissionErrors: true,
        awaitWriteFinish: coalesce ? { stabilityThreshold: 50, pollInterval: 10 } : false,
      })

      logger.debug('watch:file', `Watching [ ${dirnames.join(', ')} ]`)

      const onInterrupt = async () => {
        await watcher.close()
      }
      process.once('SIGINT', onInterrupt)

      // A watcher closed before the process is interrupted lets go of its listener: a watch that
      // re-arms otherwise left one behind each time, holding a watcher already closed.
      const close = watcher.close.bind(watcher)
      watcher.close = () => {
        process.off('SIGINT', onInterrupt)
        return close()
      }

      return watcher
    },
  },
}

process.setMaxListeners(Infinity)

process.on('unhandledRejection', (reason) => {
  logger.caughtError('process', 'Unhandled rejection', reason)
})

process.on('uncaughtException', (error) => {
  logger.caughtError('process', 'Uncaught exception', error)
})
