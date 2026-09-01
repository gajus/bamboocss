import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBuilder } from 'vite'
import { describe, expect, test } from 'vitest'

/**
 * The one sandbox that is an assertion rather than an example.
 *
 * `@vitejs/plugin-rsc` builds three environments from one run: `rsc` first, which emits the
 * stylesheet because the root server component imports it; then `client`, into which the plugin
 * copies that stylesheet by the name the server chunks recorded; then `ssr`. The app renders one
 * style only on the server, one only in the browser, and extracts one nothing reaches — so the
 * sheet has to be pruned against every environment, and every copy and every reference to it
 * has to end up under the one final name, including the manifests the plugin writes after the
 * last environment.
 */
const cwd = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(cwd, 'dist')

const readOutputs = (dir: string, files: Record<string, string> = {}, base = dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) readOutputs(path, files, base)
    else if (/\.(?:[cm]?js|css|json|html)$/.test(entry.name))
      files[path.slice(base.length + 1)] = readFileSync(path, 'utf8')
  }
  return files
}

describe('react server components', () => {
  test('the stylesheet is pruned against every environment and carried under one name', async () => {
    rmSync(dist, { force: true, recursive: true })
    const builder = await createBuilder({ root: cwd, configFile: join(cwd, 'vite.config.ts'), logLevel: 'silent' })
    await builder.buildApp()

    const outputs = readOutputs(dist)
    const sheets = Object.keys(outputs).filter((file) => file.endsWith('.css'))
    const names = new Set(sheets.map((file) => basename(file)))

    // The server build's sheet and the copy the RSC plugin made of it, under one final name.
    expect(sheets.length, 'the rsc sheet and its client copy').toBe(2)
    expect(names.size, 'one name between them').toBe(1)
    const [name] = names
    expect(name).toMatch(/\.b-[A-Za-z0-9]+\.css$/)

    for (const sheet of sheets) {
      const css = outputs[sheet]!
      expect(css, `${sheet}: the rule only the server renders`).toContain('green-700')
      expect(css, `${sheet}: the rule only the browser renders`).toContain('purple-700')
      expect(css, `${sheet}: the rule nothing reaches`).not.toContain('123.456px')
    }

    // Every reference to a stylesheet, in every environment's output and in the manifests the
    // plugin writes after the last one, names the final file.
    const references = Object.entries(outputs)
      .filter(([file]) => !file.endsWith('.css'))
      .flatMap(([file, text]) =>
        [...text.matchAll(/index-[\w-]+(?:\.b-[\w-]+)?\.css/g)].map((match) => ({ file, name: match[0] })),
      )
    expect(references.length, 'the plugin manifests reference the sheet').toBeGreaterThan(0)
    for (const reference of references) {
      expect(reference.name, reference.file).toBe(name)
    }
  }, 120_000)
})
