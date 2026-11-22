import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { BambooContext } from './create-context'

/**
 * The `.gitignore` that governs `dir` from above it: the nearest one between it and the root of
 * the repository it is in. One beyond that root applies to nothing in it, and outside any
 * repository there is no telling whose a parent's is, a home folder's included, so the project's
 * own is the one.
 */
function findGitIgnore(dir: string): string | undefined {
  let nearest: string | undefined
  for (let current = dir; ; ) {
    const file = join(current, '.gitignore')
    if (!nearest && existsSync(file)) nearest = file
    // A folder in a clone, and a file in a worktree or a submodule.
    if (existsSync(join(current, '.git'))) return nearest
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/** The path a `.gitignore` line names, so `/styled-system/` and `styled-system` read alike. */
const pathOf = (line: string) =>
  line
    .trim()
    .replace(/^(?:\*\*)?\//, '')
    .replace(/\/(?:\*\*)?$/, '')

/**
 * Ignore the generated `outdir` in the project's `.gitignore`.
 *
 * Found from the project rather than from wherever the command ran. `bamboo init --cwd apps/web`,
 * run from a monorepo's root, used to look from the root and write `styled-system` there, and with
 * no `.gitignore` in reach it created one in the shell's folder. The line is written relative to
 * the file it goes in: `src/styled-system` in the root's `.gitignore` names the root's `src`.
 */
export function setupGitIgnore(ctx: BambooContext) {
  const { cwd, outdir, gitignore } = ctx.config

  if (!gitignore) return

  const target = resolve(cwd, outdir)
  const file = findGitIgnore(cwd) ?? join(cwd, '.gitignore')
  const entry = relative(dirname(file), target).split(sep).join('/')
  // Outside the folder the file governs, where no line of it reaches.
  if (!entry || entry === '..' || entry.startsWith('../') || isAbsolute(entry)) return

  const content = existsSync(file) ? readFileSync(file, 'utf-8') : ''
  // A name with no `/` in it ignores that name at any depth, one with a `/` the path from the file.
  const paths = new Set(content.split(/\r?\n/).map(pathOf))
  if (paths.has(entry) || paths.has(basename(target))) return

  const block = `## Bamboo\n${entry}\n`
  if (!content) return writeFileSync(file, block)
  appendFileSync(file, `${content.endsWith('\n') ? '' : '\n'}\n${block}`)
}
