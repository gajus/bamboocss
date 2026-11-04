/**
 * Writes `__tests__/chrome-shorthands.json`: every property a real Chrome knows that sets anything
 * other than itself, and the longhands it sets, spelled as a style object spells them.
 * `__tests__/shorthand-priority.test.ts` reads it.
 *
 * Chrome rather than mdn-data, whose entries do not say that `white-space` sets
 * `white-space-collapse` and `text-wrap-mode`. A declaration block expands a shorthand into exactly
 * the longhands the browser will apply, so each property is set to `inherit`, which every property
 * takes, and the block is read back.
 *
 *   pnpm --filter @bamboocss/core shorthands     # CHROME=/path/to/chrome picks the binary
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const chrome =
  process.env.CHROME ??
  (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')

const output = join(__dirname, '..', '__tests__', 'chrome-shorthands.json')

/**
 * Runs in the page: every name a declaration block takes, and what setting it sets.
 *
 * Plain JavaScript in a string, not a function serialized with `String(fn)`: tsx compiles a
 * function's inner ones into `__name(…)` calls, which the page has no definition for.
 */
const expand = `
  const style = document.createElement('div').style
  const kebab = (camel) =>
    camel === 'cssFloat'
      ? 'float'
      : /^webkit[A-Z]/.test(camel)
        ? '-webkit-' + camel[6].toLowerCase() + camel.slice(7).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
        : camel.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())

  // The computed style lists every longhand; the declaration's own accessors add shorthands and
  // aliases, under their camel-cased names.
  const names = new Set(Array.from(getComputedStyle(document.documentElement)))
  for (const key in style) {
    if (typeof style[key] === 'string' && key !== 'cssText' && !/^\\d+$/.test(key)) names.add(kebab(key))
  }

  const shorthands = {}
  for (const name of [...names].sort()) {
    // \`all\` sets every longhand there is, and ranks below everything by its own rule.
    if (name === 'all') continue
    style.cssText = ''
    style.setProperty(name, 'inherit')
    const longhands = Array.from(style)
    if (longhands.length && !(longhands.length === 1 && longhands[0] === name)) shorthands[name] = longhands.sort()
  }

  document.getElementById('out').textContent = JSON.stringify(shorthands)
`

const camel = (name: string) =>
  name.replace(/^-webkit-/, 'Webkit-').replace(/-+(.)/g, (_, c: string) => c.toUpperCase())

const dir = mkdtempSync(join(tmpdir(), 'bamboo-shorthands-'))
try {
  const page = join(dir, 'expand.html')
  writeFileSync(page, `<!doctype html><pre id="out"></pre><script>${expand}</script>`)

  const dom = execFileSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      `--user-data-dir=${join(dir, 'profile')}`,
      '--dump-dom',
      pathToFileURL(page).href,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  )
  const text = /<pre id="out">(.*)<\/pre>/s.exec(dom)?.[1]
  if (!text) throw new Error(`${chrome} printed no expansions`)

  const expansions: Record<string, string[]> = JSON.parse(
    text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&'),
  )
  const shorthands = Object.fromEntries(
    Object.entries(expansions)
      .map(([name, longhands]) => [camel(name), longhands.map(camel).sort()] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )

  const version = execFileSync(chrome, ['--version'], { encoding: 'utf8' }).trim()
  writeFileSync(output, JSON.stringify({ chrome: version, shorthands }, null, 2) + '\n')
  execFileSync('oxfmt', [output], { stdio: 'ignore' })

  console.log(`${version}: ${Object.keys(shorthands).length} shorthands and aliases → ${output}`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
