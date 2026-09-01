import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import remapping from '@ampproject/remapping'
import { toHash } from '@bamboocss/shared'
import MagicString from 'magic-string'
import type { Rollup } from 'vite'
import { pruneStaticCss } from './prune-static-css'
import type { DeferredSheet, StaticCompilationSession, WrittenOutput } from './static-session'

const INLINE_SOURCE_MAP = /\n?\/\/# sourceMappingURL=data:application\/json[^\n]*$/

/** Rewrite one generated chunk without invalidating all mappings after the changed string. */
const replaceChunkReference = (
  chunk: Rollup.OutputChunk,
  bundle: Rollup.OutputBundle,
  previous: string,
  next: string,
  sourcemap: StaticCompilationSession['sourcemap'],
) => {
  if (!chunk.code.includes(previous)) return

  const magic = new MagicString(chunk.code)
  let index = chunk.code.indexOf(previous)
  while (index !== -1) {
    magic.overwrite(index, index + previous.length, next)
    index = chunk.code.indexOf(previous, index + previous.length)
  }
  chunk.code = magic.toString()

  if (!chunk.map) return
  const file = chunk.map.file
  const debugId = (chunk.map as Rollup.SourceMap & { debugId?: string }).debugId
  const combined = remapping(
    [magic.generateMap({ source: chunk.fileName, hires: 'boundary' }), chunk.map] as never,
    () => null,
  )
  if (file) combined.file = file
  if (debugId) (combined as typeof combined & { debugId?: string }).debugId = debugId
  const rollupMap = combined as unknown as Rollup.SourceMap
  rollupMap.toUrl = () =>
    `data:application/json;charset=utf-8;base64,${Buffer.from(combined.toString()).toString('base64')}`
  chunk.map = rollupMap

  if (sourcemap === 'inline') {
    chunk.code = chunk.code.replace(INLINE_SOURCE_MAP, '')
    chunk.code += `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(combined.toString()).toString('base64')}`
    return
  }

  const mapAsset = bundle[`${chunk.fileName}.map`]
  if (mapAsset?.type === 'asset') mapAsset.source = combined.toString()
}

/** Replace an emitted filename wherever Vite or Rollup has already recorded it. */
const replaceAssetReferences = (
  bundle: Rollup.OutputBundle,
  previous: string,
  next: string,
  sourcemap: StaticCompilationSession['sourcemap'],
) => {
  const replace = (value: string) => value.replaceAll(previous, next)

  for (const output of Object.values(bundle)) {
    if (output.type === 'asset') {
      if (typeof output.source === 'string') output.source = replace(output.source)
      continue
    }

    replaceChunkReference(output, bundle, previous, next, sourcemap)

    // Rollup's type declares this as required, so the guard reads as redundant and is not.
    // Our peer range is `vite: ">=5"`, which covers a Rollup-compatible bundler driving the
    // build, and a plugin may also put a chunk-shaped entry in the bundle without it. A
    // client hit exactly that and shipped a patched `dist`.
    //
    // Skipping is correct rather than a workaround: the list mirrors references the chunk's
    // own code already carries, and `replaceChunkReference` above rewrote those. An absent
    // list means there is no second copy to keep in step.
    const referencedFiles = (output as typeof output & { referencedFiles?: string[] }).referencedFiles
    if (referencedFiles) output.referencedFiles = referencedFiles.map(replace)

    // Vite's HTML, manifest, preload, and SSR-manifest passes consume this metadata. It is
    // deliberately not in Rollup's public type.
    const importedCss = (output as typeof output & { viteMetadata?: { importedCss?: Set<string> } }).viteMetadata
      ?.importedCss
    if (importedCss?.delete(previous)) importedCss.add(next)
  }
}

/**
 * Could this bundle entry be the generated stylesheet?
 *
 * The filename is checked before the bytes because the alternative decodes every asset in the
 * bundle to a UTF-8 string in order to search it — fonts, images and sourcemaps included. On an
 * app with a large asset graph that is seconds of decode and a lot of garbage, twice over, to
 * answer a question the extension already answers. The marker is a CSS custom property, so it
 * cannot occur anywhere but CSS.
 */
const isCssAsset = (output: Rollup.OutputBundle[string]): output is Rollup.OutputAsset =>
  output.type === 'asset' && output.fileName.endsWith('.css')

/** Decode a generated Bamboo stylesheet, or decline any other bundle entry. */
const generatedCssSource = (output: Rollup.OutputBundle[string]) => {
  if (!isCssAsset(output)) return undefined
  const source = typeof output.source === 'string' ? output.source : Buffer.from(output.source).toString()
  return source.includes('--made-with-bamboo') ? source : undefined
}

/**
 * Whether this bundle replaces a previously generated Bamboo stylesheet — or, given the set of
 * assets a pass already handled, whether any generated sheet is still waiting for one.
 */
export const containsGeneratedCssAsset = (bundle: Rollup.OutputBundle, handled?: WeakSet<object>) =>
  Object.values(bundle).some((output) => generatedCssSource(output) !== undefined && !handled?.has(output))

/**
 * Prune compiler-owned CSS, then give any sheet whose bytes changed a hash of those bytes.
 *
 * Rollup has already expanded `[hash]` when `generateBundle` runs. Mutating only `source`
 * would therefore leave two different reachable subsets under one CDN key. The extra final
 * hash is not cosmetic: it makes late graph reachability cache-safe.
 *
 * Renaming is therefore not a choice this takes. Pruned bytes under the unpruned sheet's name
 * is the one outcome that must never be reachable, and a sheet nothing was removed from keeps
 * its name because its bytes are unchanged — so "rename" is a consequence of "the bytes moved",
 * not a second option. `prune` is the only knob.
 */
export interface OptimizedSheet {
  /** The name Vite gave the asset. */
  original: string
  /** Its name after this pass, the same as `original` when its bytes did not move. */
  fileName: string
  /** The sheet as it was emitted, before pruning. */
  source: string
  /** The sheet as it is now in the bundle. */
  optimized: string
  /** The asset itself, as the bundler holds it. */
  asset: Rollup.OutputAsset
}

export const optimizeStaticCssAssets = (
  bundle: Rollup.OutputBundle,
  session: StaticCompilationSession,
  options: {
    environment?: string
    prune?: boolean
    requiredClasses?: ReadonlySet<string>
    sourcemap?: StaticCompilationSession['sourcemap']
    /** Assets to leave alone, and to record the ones handled here in. */
    handled?: WeakSet<object>
  } = {},
) => {
  const { environment, prune = true, requiredClasses, sourcemap = session.sourcemap, handled } = options
  /** Assets in this bundle that carry the generated stylesheet, pruned or not. */
  let sheets = 0
  /** Their file names, after any rename below. */
  const names: string[] = []
  const results: OptimizedSheet[] = []

  for (const output of Object.values(bundle)) {
    const source = generatedCssSource(output)
    if (source === undefined) continue
    if (handled?.has(output)) continue
    handled?.add(output)
    sheets++
    names.push(output.fileName)
    const original = output.fileName

    // Validation always runs: disabling reachability pruning cannot make a live class with no
    // extracted rule safe. The unpruned asset remains byte-identical because the parsed result
    // is used only when pruning is enabled.
    const optimized = pruneStaticCss(source, session, { environment, prune, requiredClasses })
    if (!prune) {
      results.push({ original, fileName: original, source, optimized: source, asset: output as Rollup.OutputAsset })
      continue
    }
    ;(output as Rollup.OutputAsset).source = optimized
    if (optimized === source) {
      results.push({ original, fileName: original, source, optimized, asset: output as Rollup.OutputAsset })
      continue
    }
    names.pop()

    // Unconditional from here. `[hash]` is expanded before this runs, so pruned bytes under
    // the original name is the worst outcome available: a change to *reachability alone* —
    // which is what a Bamboo upgrade is — leaves identical source CSS under an identical name
    // with different content, and a CDN holding that key serves the old stylesheet past the
    // deploy. One user hit that twice and worked around it by versioning the filename
    // themselves. A caller that cannot accept the rename declines the prune instead, above.
    // No "did the name actually change" guard, deliberately. `generatedCssSource` has already
    // established the `.css` ending and `toHash` never returns empty, so the replacement always
    // lengthens the name — such a guard would be dead, and dead in the one place where becoming
    // live would ship the unsafe state: `source` is assigned above, so skipping the rename here
    // is exactly pruned bytes under the unpruned name.
    const nextName = output.fileName.replace(/\.css$/, `.b-${toHash(optimized)}.css`)
    if (bundle[nextName] && bundle[nextName] !== output) {
      throw new Error(`bamboocss: final CSS asset name collision at ${JSON.stringify(nextName)}.`)
    }

    // `fileName` is mutated in place rather than by re-keying `bundle`. Replacing an entry is
    // what Rolldown refuses — it logs that the assignment is ignored and drops the asset, so
    // the build shipped no stylesheet at all — while the rename itself is fine there. Rollup
    // and Rolldown both write an asset to its `fileName`, and `replaceAssetReferences` carries
    // the recorded references across, so nothing needs the key to move.
    const previous = output.fileName
    output.fileName = nextName
    names.push(nextName)
    results.push({ original, fileName: nextName, source, optimized, asset: output as Rollup.OutputAsset })
    replaceAssetReferences(bundle, previous, nextName, sourcemap)

    // Re-keyed as well, where the bundler allows it, so a plugin that looks the asset up by the
    // name it now carries finds it. `@vitejs/plugin-rsc` does exactly that: it keeps the server
    // build's bundle and, in the client build, reads each stylesheet its chunks imported back
    // out of it by name. Rolldown ignores the assignment — and logs so — in which case the old
    // key stays and the rename still reaches disk; the guard keeps a refused assignment from
    // deleting the asset outright.
    try {
      bundle[nextName] = output
      if (bundle[nextName] === output && nextName !== previous) delete bundle[previous]
    } catch {
      // A bundle that refuses new keys keeps the old one.
    }
  }

  return { sheets, names, results }
}

/** Text outputs a stylesheet's name can appear in. Fonts and images are skipped unread. */
const REFERENCING_EXTENSIONS = /\.(?:[cm]?js|html?|css|json|txt|map|webmanifest|svg|xml)$/i
const CHUNK_EXTENSIONS = /\.[cm]?js$/i

/**
 * Rewrite one written file the way `replaceChunkReference` rewrites a chunk in memory.
 *
 * A chunk with a sourcemap — a sibling `.map`, or one inlined — has its mappings carried
 * across the edit: the replacement changes the length of a line, and every mapping after it
 * on that line would otherwise be off by the difference.
 */
const replaceFileReference = (path: string, previous: string, next: string) => {
  const code = readFileSync(path, 'utf8')
  if (!code.includes(previous)) return false

  if (!CHUNK_EXTENSIONS.test(path)) {
    writeFileSync(path, code.replaceAll(previous, next))
    return true
  }

  const magic = new MagicString(code)
  let index = code.indexOf(previous)
  while (index !== -1) {
    magic.overwrite(index, index + previous.length, next)
    index = code.indexOf(previous, index + previous.length)
  }
  let rewritten = magic.toString()

  const inlineMap = code.match(INLINE_SOURCE_MAP)?.[0]
  const mapPath = `${path}.map`
  const rawMap: { file?: string; debugId?: string } | undefined = inlineMap
    ? JSON.parse(Buffer.from(inlineMap.slice(inlineMap.indexOf('base64,') + 7), 'base64').toString())
    : existsSync(mapPath)
      ? JSON.parse(readFileSync(mapPath, 'utf8'))
      : undefined

  if (rawMap) {
    const combined = remapping(
      [magic.generateMap({ source: basename(path), hires: 'boundary' }), rawMap] as never,
      () => null,
    )
    if (rawMap.file) combined.file = rawMap.file
    if (rawMap.debugId) (combined as typeof combined & { debugId?: string }).debugId = rawMap.debugId
    if (inlineMap) {
      rewritten =
        rewritten.replace(INLINE_SOURCE_MAP, '') +
        `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(combined.toString()).toString('base64')}`
    } else {
      writeFileSync(mapPath, combined.toString())
    }
  }

  writeFileSync(path, rewritten)
  return true
}

export interface FinalizedSheet extends DeferredSheet {
  /** The name the final sheet was written under, or `undefined` when its bytes did not move. */
  renamed?: string
  before: number
  after: number
}

/**
 * Prune every deferred sheet against the whole run's reachability, on disk.
 *
 * From the *unpruned* source, not from the file: the file was pruned against a partial run and
 * may lack a rule a later environment reaches, and pruning cannot put a rule back. When the
 * final bytes are the provisional bytes — the common case, since a later environment usually
 * reaches nothing new — nothing on disk moves and every recorded name stays right. When they
 * differ, the same contract as `optimizeStaticCssAssets` applies: the bytes and the name move
 * together, every written reference moves with them across environments, and a copy of the
 * provisional sheet a framework wrote into another output is replaced the same way.
 */
export const finalizeDeferredSheets = (
  sheets: readonly DeferredSheet[],
  session: StaticCompilationSession,
  options: {
    requiredClasses?: ReadonlySet<string>
    prune?: boolean
    outputs: readonly WrittenOutput[]
    /** The bundle being generated as this runs, whose references have not reached disk yet. */
    bundle?: object
    sourcemap?: StaticCompilationSession['sourcemap']
  },
): FinalizedSheet[] => {
  const { requiredClasses, prune = true, outputs, bundle, sourcemap = session.sourcemap } = options
  const finalized: FinalizedSheet[] = []

  for (const sheet of sheets) {
    const path = join(sheet.dir, sheet.fileName)
    // A later plugin may have moved or removed the file. Nothing to finalize, and nothing to
    // rewrite: whatever replaced it was derived from bytes this pass never changed.
    if (!existsSync(path)) continue

    const final = pruneStaticCss(sheet.source, session, { prune, requiredClasses })
    if (!prune || final === sheet.provisional) {
      finalized.push({ ...sheet, before: sheet.provisional.length, after: sheet.provisional.length })
      continue
    }

    const nextName = sheet.originalFileName.replace(/\.css$/, `.b-${toHash(final)}.css`)
    const directories = new Set<string>([sheet.dir])
    for (const output of outputs) directories.add(output.dir)

    // The sheet, and every copy of it another output carries under the same name.
    for (const dir of directories) {
      const copy = join(dir, sheet.fileName)
      if (!existsSync(copy)) continue
      if (dir !== sheet.dir && readFileSync(copy, 'utf8') !== sheet.provisional) continue
      writeFileSync(join(dir, nextName), final)
      rmSync(copy, { force: true })
    }

    const seen = new Set<string>()
    for (const output of outputs) {
      for (const file of output.files) {
        if (!REFERENCING_EXTENSIONS.test(file)) continue
        const target = join(output.dir, file)
        if (seen.has(target) || file === sheet.fileName) continue
        seen.add(target)
        if (!existsSync(target)) continue
        replaceFileReference(target, sheet.fileName, nextName)
      }
    }

    // The asset as the bundler still holds it, and the finished bundle around it, for a
    // framework that keeps that bundle and copies the sheet into a later build by the name its
    // chunks recorded — `@vitejs/plugin-rsc` does both. And the bundle in flight, whose own
    // references are not on disk yet.
    if (sheet.asset) {
      sheet.asset.source = final
      sheet.asset.fileName = nextName
      if (sheet.bundle) {
        try {
          sheet.bundle[nextName] = sheet.asset
          if (sheet.bundle[nextName] === sheet.asset) delete sheet.bundle[sheet.fileName]
        } catch {
          // A bundle that refuses new keys keeps the old one.
        }
        replaceAssetReferences(sheet.bundle as Rollup.OutputBundle, sheet.fileName, nextName, sheet.sourcemap)
      }
    }
    if (bundle) replaceAssetReferences(bundle as Rollup.OutputBundle, sheet.fileName, nextName, sourcemap)

    finalized.push({ ...sheet, renamed: nextName, before: sheet.provisional.length, after: final.length })
  }

  return finalized
}

export { pruneStaticCss } from './prune-static-css'
