import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import remapping from '@ampproject/remapping'
import type { AtomOrigin } from '@bamboocss/core'
import { toHash } from '@bamboocss/shared'
import { GenMapping, addMapping, toEncodedMap } from '@jridgewell/gen-mapping'
import MagicString from 'magic-string'
import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'
import type { Rollup } from 'vite'
import { bare } from './class-name'
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
export const containsGeneratedCssAsset = (
  bundle: Rollup.OutputBundle,
  handled?: WeakSet<object>,
  handledNames?: ReadonlySet<string>,
) =>
  Object.values(bundle).some(
    (output) =>
      generatedCssSource(output) !== undefined && !handled?.has(output) && !handledNames?.has(output.fileName),
  )

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
  /** Escape-free classes moved into chunk sheets of their own. */
  moved: ReadonlySet<string>
}

export interface SplitOptions {
  /** Which lazily loaded chunk each exclusive atom belongs to. @see `ChunkOwnership` */
  ownership: ChunkOwnership
  /** Emit one chunk's sheet, and attach it to that chunk. */
  emit: (chunk: string, css: string) => void
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
    /** The same by file name, for a bundler whose asset objects do not keep their identity. */
    handledNames?: Set<string>
    /** Move each lazily loaded chunk's exclusive atoms into a sheet of its own. */
    split?: SplitOptions
  } = {},
) => {
  const {
    environment,
    prune = true,
    requiredClasses,
    sourcemap = session.sourcemap,
    handled,
    handledNames,
    split,
  } = options
  /** Assets in this bundle that carry the generated stylesheet, pruned or not. */
  let sheets = 0
  /** Their file names, after any rename below. */
  const names: string[] = []
  const results: OptimizedSheet[] = []

  for (const output of Object.values(bundle)) {
    const source = generatedCssSource(output)
    if (source === undefined) continue
    if (handled?.has(output) || handledNames?.has(output.fileName)) continue
    handled?.add(output)
    handledNames?.add(output.fileName)
    sheets++
    names.push(output.fileName)
    const original = output.fileName

    // Validation always runs: disabling reachability pruning cannot make a live class with no
    // extracted rule safe. The unpruned asset remains byte-identical because the parsed result
    // is used only when pruning is enabled.
    const pruned = pruneStaticCss(source, session, { environment, prune, requiredClasses })
    if (!prune) {
      results.push({
        original,
        fileName: original,
        source,
        optimized: source,
        asset: output as Rollup.OutputAsset,
        moved: new Set(),
      })
      continue
    }

    // After pruning, so an atom nothing reaches never gets a sheet; before the rename, so the
    // entry sheet's name describes its bytes with the moved rules gone.
    let optimized = pruned
    let moved: ReadonlySet<string> = new Set()
    if (split?.ownership.size) {
      const divided = splitStaticCss(pruned, session, split.ownership)
      optimized = divided.css
      moved = divided.moved
      for (const [chunk, css] of divided.chunks) split.emit(chunk, css)
    }

    ;(output as Rollup.OutputAsset).source = optimized
    if (optimized === source) {
      results.push({ original, fileName: original, source, optimized, asset: output as Rollup.OutputAsset, moved })
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
    handledNames?.add(nextName)
    results.push({ original, fileName: nextName, source, optimized, asset: output as Rollup.OutputAsset, moved })
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

    let final = pruneStaticCss(sheet.source, session, { prune, requiredClasses })
    // The rules that went to chunk sheets of their own are still in the source; they belong
    // where they went, and only the entry sheet is being decided here.
    if (sheet.moved?.size) {
      final = splitStaticCss(final, session, new Map([...sheet.moved].map((className) => [className, '']))).css
    }
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

/**
 * What decides which chunk a utility rule belongs to, by the escape-free class it selects on.
 *
 * Only atoms exclusive to a chunk that is not loaded with an entry appear here. Everything
 * else — an atom two chunks use, one an entry or its static imports reach, `staticCss` — has no
 * owner and stays in the entry sheet, which is what every route loads.
 */
export type ChunkOwnership = ReadonlyMap<string, string>

export interface SplitStaticCssResult {
  /** The entry sheet with the owned rules taken out. */
  css: string
  /** One sheet per owning chunk, keyed as `ownership` keys them. */
  chunks: Map<string, string>
  /** The escape-free classes moved out, for a finalization that has to move them again. */
  moved: Set<string>
}

/** The at-rules a rule sits under, outermost first, as name and params. */
const ancestryOf = (rule: postcss.Rule) => {
  const chain: Array<{ name: string; params: string }> = []
  let parent = rule.parent as postcss.Node | undefined
  while (parent && parent.type !== 'root') {
    if (parent.type === 'atrule') {
      const atRule = parent as postcss.AtRule
      chain.unshift({ name: atRule.name, params: atRule.params })
    }
    parent = parent.parent as postcss.Node | undefined
  }
  return chain
}

/** The container in `root` under the same at-rule chain, created where absent. */
const containerFor = (root: postcss.Root, chain: ReadonlyArray<{ name: string; params: string }>) => {
  let container: postcss.Container = root
  for (const { name, params } of chain) {
    let next = container.nodes?.find(
      (node): node is postcss.AtRule =>
        node.type === 'atrule' && (node as postcss.AtRule).name === name && (node as postcss.AtRule).params === params,
    )
    if (!next) {
      next = postcss.atRule({ name, params, nodes: [] })
      container.append(next)
    }
    container = next
  }
  return container
}

/**
 * Move every utility rule a lazily loaded chunk owns into a sheet of that chunk's own.
 *
 * Reads the finished entry sheet — pruned, sublayered, minified or not — and walks its
 * utility rules. A selector naming exactly one class that `ownership` assigns to a chunk is
 * moved to that chunk's sheet under the same at-rule chain: the utilities layer, its sublayer,
 * any media or container query. A rule with several selectors is split per selector, since a
 * merged rule's members can belong to different chunks. Whatever nothing owns stays.
 *
 * Each chunk sheet opens with the entry's sublayer order statement, so whichever sheet the
 * document happens to parse first establishes the same order. That is what makes the split
 * safe at all: precedence lives in the sublayers, not in where a rule sits.
 */
export const splitStaticCss = (
  css: string,
  session: StaticCompilationSession,
  ownership: ChunkOwnership,
): SplitStaticCssResult => {
  const chunks = new Map<string, string>()
  const moved = new Set<string>()
  if (!ownership.size || !css.includes('--made-with-bamboo')) return { css, chunks, moved }

  const root = postcss.parse(css)
  const roots = new Map<string, postcss.Root>()
  const rootFor = (chunk: string) => {
    let chunkRoot = roots.get(chunk)
    if (!chunkRoot) {
      chunkRoot = postcss.root()
      roots.set(chunk, chunkRoot)
    }
    return chunkRoot
  }

  const isUtilityRule = (rule: postcss.Rule) => {
    let parent = rule.parent as postcss.Node | undefined
    while (parent) {
      if (parent.type === 'atrule') {
        const atRule = parent as postcss.AtRule
        if (atRule.name === 'layer' && atRule.params === session.utilityLayer) return true
      }
      parent = parent.parent as postcss.Node | undefined
    }
    return false
  }

  let order: postcss.AtRule | undefined
  root.walkAtRules('layer', (atRule) => {
    if (order || atRule.nodes) return
    const parent = atRule.parent
    if (parent?.type === 'atrule' && (parent as postcss.AtRule).params === session.utilityLayer) order = atRule
  })

  root.walkRules((rule) => {
    if (!isUtilityRule(rule)) return

    const kept: string[] = []
    const taken = new Map<string, string[]>()
    for (const selector of rule.selectors) {
      let owner: string | undefined
      try {
        selectorParser((selectors) => {
          const classes = new Set<string>()
          selectors.walkClasses((classNode) => {
            classes.add(bare(classNode.toString().slice(1)))
          })
          if (classes.size !== 1) return
          const [className] = classes
          owner = ownership.get(className!)
          if (owner !== undefined) moved.add(className!)
        }).processSync(selector)
      } catch {
        // An authored selector the parser cannot read is not a compiler-owned atom.
      }
      if (owner === undefined) kept.push(selector)
      else (taken.get(owner) ?? taken.set(owner, []).get(owner)!).push(selector)
    }
    if (!taken.size) return

    const chain = ancestryOf(rule)
    for (const [chunk, selectors] of taken) {
      containerFor(rootFor(chunk), chain).append(rule.clone({ selectors }))
    }
    if (kept.length) rule.selectors = kept
    else rule.remove()
  })

  // Removing the last rule from a condition or layer should remove its wrappers as well.
  let removed = true
  while (removed) {
    removed = false
    root.walkAtRules((atRule) => {
      if (atRule.nodes?.length !== 0) return
      atRule.remove()
      removed = true
    })
  }

  for (const [chunk, chunkRoot] of roots) {
    if (order) {
      const utilities = chunkRoot.nodes.find(
        (node): node is postcss.AtRule =>
          node.type === 'atrule' &&
          (node as postcss.AtRule).name === 'layer' &&
          (node as postcss.AtRule).params === session.utilityLayer,
      )
      utilities?.prepend(order.clone())
    }
    chunks.set(chunk, chunkRoot.toString())
  }

  return { css: root.toString(), chunks, moved }
}

/** The served stylesheet's source map, as Vite's `load` hook takes one. @see `cssSourceMap` */
export type CssSourceMap = Rollup.ExistingRawSourceMap

/** A class token of a selector, escapes and all: `.hover\\:c_red600` up to its unescaped `:`. */
const CLASS_TOKEN = /\.((?:\\.|[^\\\s.:>+~[\](),])+)/g

/**
 * The top-level comma-separated parts of a selector list as written, each with its offset.
 *
 * `rule.selectors` splits the same way but loses where each part sits, and a merged rule's
 * selectors sit on separate lines in the unminified sheet a dev server serves.
 */
const selectorParts = (raw: string) => {
  const parts: Array<{ text: string; offset: number }> = []
  let depth = 0
  let start = 0
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]
    if (char === '\\') index++
    else if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth--
    else if (char === ',' && depth === 0) {
      parts.push({ text: raw.slice(start, index), offset: start })
      start = index + 1
    }
  }
  parts.push({ text: raw.slice(start), offset: start })
  return parts.map((part) => {
    const leading = part.text.length - part.text.trimStart().length
    return { text: part.text.trim(), offset: part.offset + leading }
  })
}

/** `start` advanced over `text` up to `offset`, in 1-based lines and columns. */
const positionAt = (text: string, offset: number, start: { line: number; column: number }) => {
  let { line, column } = start
  for (let index = 0; index < offset; index++) {
    if (text[index] === '\n') {
      line++
      column = 1
    } else column++
  }
  return { line, column }
}

/**
 * A source map from each rule of the served stylesheet to the call site its atom was first
 * encoded at, for DevTools to name the file and line a rule came from.
 *
 * Read off the finished sheet rather than threaded through its generation: rules enter the
 * postcss tree as strings, which strips their positions, and the optimizer re-parses the text
 * twice more. One parse here costs the same as one of those and needs no cooperation from
 * either. A rule maps at its selector, and a merged rule maps each of its selectors, since
 * the optimizer folds rules from different call sites into one. `sourcesContent` is left for
 * Vite to fill from disk, which it does for a dev stylesheet's map before inlining it.
 */
export const cssSourceMap = (css: string, origins: ReadonlyMap<string, AtomOrigin>): CssSourceMap | undefined => {
  const byBareClass = new Map<string, AtomOrigin>()
  for (const [className, origin] of origins) {
    const name = bare(className)
    if (!byBareClass.has(name)) byBareClass.set(name, origin)
  }
  if (!byBareClass.size) return undefined

  const originOf = (selector: string) => {
    for (const match of selector.matchAll(CLASS_TOKEN)) {
      const origin = byBareClass.get(bare(match[1]!))
      if (origin) return origin
    }
    return undefined
  }

  const map = new GenMapping()
  let mapped = 0
  postcss.parse(css).walkRules((rule) => {
    const start = rule.source?.start
    if (!start) return
    const raw = rule.raws.selector?.raw ?? rule.selector
    for (const part of selectorParts(raw)) {
      const origin = originOf(part.text)
      if (!origin) continue
      const generated = positionAt(raw, part.offset, start)
      addMapping(map, {
        generated: { line: generated.line, column: generated.column - 1 },
        source: origin.filePath,
        original: { line: origin.line, column: origin.column - 1 },
      })
      mapped++
    }
  })
  if (!mapped) return undefined
  const encoded = toEncodedMap(map)
  return {
    version: 3,
    mappings: encoded.mappings,
    names: [...encoded.names],
    sources: encoded.sources.map((source) => source ?? ''),
  }
}
