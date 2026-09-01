import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { esc, toHash } from '@bamboocss/shared'
import MagicString from 'magic-string'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { finalizeDeferredSheets, pruneStaticCss } from '../src/css-output-module'
import { createStaticCompilationSession, type DeferredSheet } from '../src/static-session'

/**
 * The stylesheet is emitted by the environment that imports it, usually the first to build, and
 * reachability is only whole once every environment has compiled. So a written sheet goes to
 * disk pruned against what the run knew, and this is the pass that prunes it again from source
 * once the last environment has written. Usually that produces the bytes already on disk and
 * nothing moves; when a later environment restored a rule, the final bytes go under a new name
 * and every written reference is rewritten in place — across environments, because a server
 * bundle embeds the client's asset names, and including any copy of the provisional sheet a
 * framework wrote into another output.
 */
const sheet =
  `@layer reset, base, tokens, utilities;` +
  `@layer utilities{.h_\\[345\\.6789px\\]{height:345.6789px}.w_\\[12\\.5px\\]{width:12.5px}}` +
  `:root{--made-with-bamboo:🌱}`

const ORIGINAL = 'assets/index-aaaaaaaa.css'
const CHUNK = 'assets/entry-bbbbbbbb.js'

/**
 * `usedClasses` is the keep set and `requiredClasses` the orphan check, both derived from one
 * reachability projection in the plugin. The fixture supplies them together for the same
 * reason: a required atom nothing marked used would be pruned and then reported missing.
 */
const session = (used: string[]) => {
  const created = createStaticCompilationSession()
  created.prunableClasses.add(esc('h_[345.6789px]'))
  created.prunableClasses.add(esc('w_[12.5px]'))
  for (const className of used) created.markClassUsed(className)
  return created
}
const required = (used: string[]) => new Set(used.map(esc))

describe('finalizing a deferred stylesheet on disk', () => {
  let root: string
  let client: string
  let server: string
  /** The sheet as the client environment wrote it: pruned against the client alone. */
  let provisional: string
  let provisionalName: string
  let deferred: DeferredSheet

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bamboo-deferred-'))
    client = join(root, 'client')
    server = join(root, 'server')
    mkdirSync(join(client, 'assets'), { recursive: true })
    mkdirSync(join(client, '.vite'), { recursive: true })
    mkdirSync(join(server, 'assets'), { recursive: true })

    provisional = pruneStaticCss(sheet, session(['w_[12.5px]']), { requiredClasses: required(['w_[12.5px]']) })
    provisionalName = ORIGINAL.replace(/\.css$/, `.b-${toHash(provisional)}.css`)
    deferred = {
      environment: 'client',
      dir: client,
      originalFileName: ORIGINAL,
      fileName: provisionalName,
      source: sheet,
      provisional,
      sourcemap: false,
    }

    writeFileSync(join(client, provisionalName), provisional)
    writeFileSync(join(client, 'index.html'), `<link rel="stylesheet" href="/${provisionalName}">`)
    writeFileSync(join(client, '.vite/manifest.json'), JSON.stringify({ 'index.html': { css: [provisionalName] } }))
    // A chunk naming the sheet, with the sourcemap a build writes beside it.
    const magic = new MagicString(`const a = 1\nimport("/${provisionalName}")\nconst b = a\n`)
    writeFileSync(join(client, CHUNK), magic.toString())
    writeFileSync(
      join(client, `${CHUNK}.map`),
      magic.generateMap({ source: 'entry.ts', file: 'entry-bbbbbbbb.js', hires: true }).toString(),
    )
    // The server bundle embeds the client's asset names, as a framework's manifest does — and
    // carries a copy of the sheet itself, as the RSC plugin copies a server build's CSS.
    writeFileSync(join(server, 'index.js'), `export const assets = ["/${provisionalName}"]\n`)
    writeFileSync(join(server, provisionalName), provisional)
    // Not text, and never read.
    writeFileSync(join(client, 'assets/logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })

  afterEach(() => rmSync(root, { force: true, recursive: true }))

  const outputs = () => [
    {
      environment: 'client',
      dir: client,
      files: [provisionalName, 'index.html', '.vite/manifest.json', CHUNK, `${CHUNK}.map`, 'assets/logo.png'],
    },
    { environment: 'ssr', dir: server, files: ['index.js', provisionalName] },
  ]

  test('restores a rule a later environment reaches, renames to the final bytes, and rewrites every reference', () => {
    const both = ['w_[12.5px]', 'h_[345.6789px]']
    const active = session(both)

    const [result] = finalizeDeferredSheets([deferred], active, { requiredClasses: required(both), outputs: outputs() })

    expect(result?.renamed).toMatch(/^assets\/index-aaaaaaaa\.b-[A-Za-z0-9]+\.css$/)
    expect(result?.renamed).not.toBe(provisionalName)
    expect(existsSync(join(client, provisionalName)), 'the provisional file is gone').toBe(false)

    const final = readFileSync(join(client, result!.renamed!), 'utf8')
    expect(final).toContain('12.5px')
    expect(final, 'the rule only the later environment reaches is back').toContain('345.6789px')

    for (const file of ['index.html', '.vite/manifest.json', CHUNK]) {
      const text = readFileSync(join(client, file), 'utf8')
      expect(text, file).toContain(result!.renamed!)
      expect(text, file).not.toContain(provisionalName)
    }
    const serverText = readFileSync(join(server, 'index.js'), 'utf8')
    expect(serverText).toContain(result!.renamed!)
    expect(serverText).not.toContain(provisionalName)

    // The copy another output carried moved with it.
    expect(existsSync(join(server, provisionalName))).toBe(false)
    expect(readFileSync(join(server, result!.renamed!), 'utf8')).toBe(final)

    // Nothing was removed from source this time, so the loss history is empty.
    expect(active.prunedClasses).toEqual(new Set())
  })

  test('carries a chunk sourcemap across the rewrite', () => {
    const both = ['w_[12.5px]', 'h_[345.6789px]']
    const before = JSON.parse(readFileSync(join(client, `${CHUNK}.map`), 'utf8'))

    finalizeDeferredSheets([deferred], session(both), { requiredClasses: required(both), outputs: outputs() })

    const after = JSON.parse(readFileSync(join(client, `${CHUNK}.map`), 'utf8'))
    expect(after.file).toBe(before.file)
    expect(after.sources).toEqual(before.sources)
    expect(typeof after.mappings).toBe('string')
    expect(after.mappings.length).toBeGreaterThan(0)
  })

  test('leaves everything alone when the later environments reached nothing new', () => {
    const active = session(['w_[12.5px]'])

    const [result] = finalizeDeferredSheets([deferred], active, {
      requiredClasses: required(['w_[12.5px]']),
      outputs: outputs(),
    })

    expect(result?.renamed).toBeUndefined()
    expect(readFileSync(join(client, provisionalName), 'utf8')).toBe(provisional)
    expect(readFileSync(join(server, 'index.js'), 'utf8')).toContain(provisionalName)
    // What the final prune removed from source is exactly what the provisional one had.
    expect(active.prunedClasses).toEqual(new Set(['h_[345.6789px]']))
  })

  test('leaves everything alone under pruneCss: false', () => {
    const [result] = finalizeDeferredSheets([deferred], session(['w_[12.5px]']), {
      prune: false,
      requiredClasses: required(['w_[12.5px]']),
      outputs: outputs(),
    })

    expect(result?.renamed).toBeUndefined()
    expect(readFileSync(join(client, provisionalName), 'utf8')).toBe(provisional)
  })

  test('fails the run when live output names a class the sheet cannot back', () => {
    expect(() =>
      finalizeDeferredSheets([deferred], session(['w_[12.5px]']), {
        requiredClasses: new Set([esc('c_missing')]),
        outputs: outputs(),
      }),
    ).toThrow(/have no rule/)
  })

  test('skips a sheet a later plugin already moved', () => {
    rmSync(join(client, provisionalName))

    expect(finalizeDeferredSheets([deferred], session(['w_[12.5px]']), { outputs: outputs() })).toEqual([])
  })
})
