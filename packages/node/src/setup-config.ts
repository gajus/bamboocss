import { findConfig } from '@bamboocss/config'
import { messages } from '@bamboocss/core'
import { logger, quote } from '@bamboocss/logger'
import { BambooError } from '@bamboocss/shared'
import type { Config } from '@bamboocss/types'
import { lookItUpSync } from 'look-it-up'
import { outdent } from 'outdent'
import { readFileSync, statSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

type SetupOptions = Partial<Config> & {
  force?: boolean
}

/** The project `init` set up, as it read it off the project's manifest. */
export interface InitProject {
  /** The framework the project depends on, where `init` knows it. */
  framework?: string
  /** Its installation guide, `https://bamboocss.com/docs/installation/<guide>`. */
  guide: string
  /** What `include` is written with. */
  include: string[]
}

interface Framework {
  name: string
  guide: string
  matches: (has: (name: string) => boolean) => boolean
  /** Where its sources are: a folder's every file, `./src/**`, or one file. */
  roots: (isDirectory: (path: string) => boolean) => string[]
}

const viteRoots = ['./src/**', './pages/**']

/**
 * The frameworks `init` writes `include` for, as their installation guides do. The first one a
 * project depends on wins: Nuxt depends on Vue, and an Astro project often on React.
 */
const frameworks: Framework[] = [
  {
    name: 'Nuxt',
    guide: 'nuxt',
    matches: (has) => has('nuxt'),
    // Nuxt 4 reads `app/` where there is one, and the project's root otherwise.
    roots: (isDirectory) =>
      isDirectory('app') ? ['./app/**'] : ['./app.vue', './components/**', './layouts/**', './pages/**'],
  },
  {
    name: 'React Router',
    guide: 'react-router',
    matches: (has) => has('@react-router/dev'),
    roots: () => ['./app/**'],
  },
  {
    name: 'TanStack Start',
    guide: 'tanstack-start',
    matches: (has) => has('@tanstack/react-start') || has('@tanstack/solid-start'),
    roots: () => ['./src/**'],
  },
  { name: 'Astro', guide: 'astro', matches: (has) => has('astro'), roots: () => ['./src/**'] },
  { name: 'SvelteKit', guide: 'svelte', matches: (has) => has('@sveltejs/kit'), roots: () => ['./src/**'] },
  { name: 'Svelte', guide: 'svelte', matches: (has) => has('svelte'), roots: () => ['./src/**'] },
  {
    name: 'Qwik',
    guide: 'qwik',
    matches: (has) => has('@builder.io/qwik') || has('@qwik.dev/core'),
    roots: () => viteRoots,
  },
  { name: 'Vue', guide: 'vue', matches: (has) => has('vue'), roots: () => ['./src/**'] },
  { name: 'Solid', guide: 'solidjs', matches: (has) => has('solid-js'), roots: () => viteRoots },
  { name: 'Preact', guide: 'preact', matches: (has) => has('preact'), roots: () => viteRoots },
]

/**
 * Where a project's style calls are, by what its manifest depends on.
 *
 * `init` used to write `./src/**` and `./pages/**` for JS and TS files whatever the project was,
 * which missed React Router's `app/`, a Nuxt project's folders, and every `.vue`, `.svelte` and
 * `.astro` file. A module the compiler compiles that extraction never read fails the build.
 */
export function detectInitProject(cwd: string): InitProject {
  const manifestFile = lookItUpSync('package.json', cwd)
  let manifest: Record<string, unknown> = {}
  try {
    if (manifestFile) manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  } catch {
    // Read as depending on nothing, which writes what `init` always wrote.
  }
  const dependencies = new Set(
    ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap((field) => {
      const value = manifest[field]
      return value && typeof value === 'object' ? Object.keys(value) : []
    }),
  )
  const has = (name: string) => dependencies.has(name)
  const isDirectory = (path: string) => statSync(join(cwd, path), { throwIfNoEntry: false })?.isDirectory() ?? false

  const framework = frameworks.find((candidate) => candidate.matches(has))
  // Single-file components wherever the project can have them: Astro renders Vue and Svelte too.
  const extensions = [
    'js',
    'jsx',
    'ts',
    'tsx',
    ...(has('vue') || has('nuxt') ? ['vue'] : []),
    ...(has('svelte') ? ['svelte'] : []),
    ...(has('astro') ? ['astro'] : []),
  ]
  const roots = [...(framework?.roots(isDirectory) ?? viteRoots)]
  // Stories kept beside the application rather than in it.
  if (has('storybook') && isDirectory('stories')) roots.push('./stories/**')

  return {
    framework: framework?.name,
    guide: framework?.guide ?? 'vite',
    include: roots.map((root) => (root.endsWith('/**') ? `${root}/*.{${extensions.join(',')}}` : root)),
  }
}

export async function setupConfig(cwd: string, opts: SetupOptions = {}): Promise<InitProject> {
  const { force, outExtension, outdir = 'styled-system', strictValues } = opts

  let configFile: string | undefined

  try {
    configFile = findConfig({ cwd })
  } catch (err) {
    // ignore config not found error
    if (!(err instanceof BambooError)) {
      throw err
    }
  }

  const { detect } = await import('package-manager-detector')
  const pmResult = await detect({ cwd })
  const pm = (pmResult?.agent ?? 'npm').split('@')[0]
  // What runs a package's binary: `npx bamboo`, and `pnpm bamboo`, `yarn bamboo`, `bun bamboo`.
  const cmd = pm === 'npm' ? 'npx' : pm

  const isTs = lookItUpSync('tsconfig.json', cwd)
  const file = isTs ? 'bamboo.config.ts' : 'bamboo.config.mjs'
  const project = detectInitProject(cwd)

  if (!force && configFile) {
    logger.warn('init:config', messages.configExists(cmd))
  } else {
    logger.info('init:config', `creating bamboo config file: ${quote(file)}`)
    if (project.framework) {
      logger.info(
        'init:config',
        `${project.framework} project: include ${project.include.map((glob) => quote(glob)).join(', ')}`,
      )
    }
    const content = outdent`
import { defineConfig } from "@bamboocss/dev"

export default defineConfig({
    // Whether to use css reset
    preflight: true,
    ${outExtension ? `\n // The extension for the emitted JavaScript files\noutExtension: '${outExtension}',` : ''}
    // Where to look for your css declarations
    include: [${project.include.map((glob) => JSON.stringify(glob)).join(', ')}],
${
  // Written only when asked for, and nothing at all otherwise — including no blank line.
  // The key is absent by default rather than present and `false`, so a config that never
  // mentions it reads as "not a decision I made", which is what `bamboo init` without the
  // flag is.
  strictValues
    ? `\n// Require every style value to be a token, so a raw css value is written \`[14px]\`.\n` +
      `// A misspelled token is reported by the build whether or not this is on.\n` +
      `strictValues: ${JSON.stringify(strictValues)},\n`
    : ''
}

    // Files to exclude
    exclude: [],

    // Tokens, keyframes and @property rules nothing in the emitted css reaches are dropped
    // by default — worth 36-78% of a new project's stylesheet. If you read tokens from
    // somewhere the build cannot see them — \`token()\` with a computed path, or a
    // hand-written stylesheet outside \`include\` — name the categories they land in with
    // \`prune: { keepTokens: ['colors.*'] }\`, or set \`prune: { tokens: false }\`.

    // Useful for theme customization
    theme: {
      extend: {}
    },

    // The output directory for your css system
    outdir: ${JSON.stringify(outdir)},
})
    `

    const filePath = join(cwd, file)
    await writeFile(filePath, content)
    try {
      execFileSync('oxfmt', [filePath], { stdio: 'ignore' })
    } catch {
      // oxfmt not available, file is written unformatted
    }
    logger.log(messages.thankYou())
  }

  return project
}
