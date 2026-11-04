import { realpathSync } from 'node:fs'

const slashed = (path: string) => path.replaceAll('\\', '/')

/**
 * The files, each real one once: under the first of the paths the glob reached it by.
 *
 * Two links in `include` to one folder — `src/shared` and `vendor/shared`, a package linked twice —
 * and the inventory holds each of its files under both, as two patterns walked apart each find it,
 * which is how the watcher and a bundler naming a module have to find it. One walk enters a folder
 * once, so a single pattern finds it by one path. Extracted, each was
 * read twice for the same styles. The first of them in the inventory's order is the one kept: an
 * atom sits at the rank of the earliest file that wrote it, which is that one, so the stylesheet's
 * order is as it was.
 *
 * `linked` is what the glob reports reaching through a link, each resolved once; a glob that
 * reached none hands the files back as they are, without a look at the filesystem. Among it is
 * the folder each walk began at, and a file an exact pattern names, so a file reached directly is
 * compared as it really is too: a project under a link of its own — macOS's `/tmp` — is read once
 * as much as one under none.
 */
export const firstSpellingOfEachFile = (files: readonly string[], linked: readonly string[]): readonly string[] => {
  if (!linked.length) return files
  const links: Array<{ spelled: string; spelledPrefix: string; real: string }> = []
  for (const link of linked) {
    let real: string
    try {
      real = slashed(realpathSync.native(link))
    } catch {
      continue
    }
    const spelled = slashed(link)
    if (real !== spelled) links.push({ spelled, spelledPrefix: `${spelled}/`, real })
  }
  if (!links.length) return files
  // Deepest first, so the link nearest a file answers for it.
  links.sort((left, right) => right.spelled.length - left.spelled.length)

  const seen = new Set<string>()
  return files.filter((file) => {
    const path = slashed(file)
    let real = path
    for (const { spelled, spelledPrefix, real: target } of links) {
      if (path === spelled) real = target
      else if (path.startsWith(spelledPrefix)) real = target + path.slice(spelled.length)
      else continue
      break
    }
    if (seen.has(real)) return false
    seen.add(real)
    return true
  })
}
