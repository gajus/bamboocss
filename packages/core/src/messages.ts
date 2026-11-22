import { colors, quote } from '@bamboocss/logger'
import { outdent } from 'outdent'
import type { Context } from './context'

const tick = colors.green().bold('✔️')

export const artifactsGenerated = (ctx: Pick<Context, 'config' | 'recipes' | 'patterns' | 'tokens' | 'jsx'>) => {
  const {
    config: { outdir, theme },
    recipes,
    patterns,
    tokens,
  } = ctx

  return () =>
    [
      outdent`
    ${tick} ${quote(outdir, '/css')}: the css function to author styles
    `,
      !tokens.isEmpty &&
        outdent`
    ${tick} ${quote(outdir, '/tokens')}: the css variables and js function to query your tokens
    `,
      !patterns.isEmpty() &&
        outdent`
    ${tick} ${quote(outdir, '/patterns')}: functions to implement and apply common layout patterns
    `,
      !recipes.isEmpty() &&
        outdent`
      ${tick} ${quote(outdir, '/recipes')}: functions to create multi-variant styles
      `,
      theme?.variants &&
        outdent`
    ${tick} ${quote(outdir, '/themes')}: theme variants for your design system
    `,
      '\n',
    ]
      .filter(Boolean)
      .join('\n')
}

/** `cmd` runs a package's binary in the project's package manager: `npx`, `pnpm`, `yarn` or `bun`. */
export const configExists = (cmd: string) => outdent`
      \n
      A Bamboo config already exists here, so init left it as it is.

      To replace it with a new one, run ${quote(cmd, ' bamboo init --force')}.

      `

export const thankYou = () => outdent`

  🚀 Thanks for choosing ${colors.cyan('Bamboo')} to write your css.

  You are set up to start using Bamboo!

  `

/**
 * What a project needs after `bamboo init`, which is the Vite setup: the plugin is what compiles
 * and emits the styles, and the stylesheet declares its own layers, so there is no `@layer`
 * statement to write. Where each goes differs by framework, which its installation guide says.
 */
export const codegenComplete = (guide = 'vite') =>
  outdent`

  ${colors.bold().cyan('Next steps:')}

  [1] Add the plugin to your Vite config:

      import bamboocss from '@bamboocss/vite'

      plugins: [bamboocss()]

  [2] Import the stylesheet once, from your entry module:

      import 'virtual:bamboo.css'

      With TypeScript, reference its types beside vite/client:

      /// <reference types="@bamboocss/vite/client" />

  [3] Add ${quote('"prepare": "bamboo codegen"')} to your package.json scripts.

  See https://bamboocss.com/docs/installation/${guide}

  `

export const noExtract = () =>
  outdent`
  No style object or props were detected in your source files.
  If this is unexpected, double-check the \`include\` options in your Bamboo config\n
`

export const watch = () =>
  outdent`
  Watching for file changes...
  `

export const configWatch = () =>
  outdent`
  Watching for config file changes...
  `

export const buildComplete = (count: number) =>
  outdent`
  Successfully extracted css from ${count} file(s) ✨
  `

const randomWords = ['Sweet', 'Divine', 'Bamboolicious', 'Super']
const pickRandom = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)]

export const exclamation = () => `🎋 ${pickRandom(randomWords)}! ✨`

export const cssArtifactComplete = (type: string) => `Successfully generated ${type} css artifact ✨`

export const getMessages = (ctx: Pick<Context, 'config' | 'recipes' | 'patterns' | 'tokens' | 'jsx'>) => ({
  artifactsGenerated: artifactsGenerated(ctx),
  configExists,
  thankYou,
  codegenComplete,
  noExtract,
  watch,
  buildComplete,
  configWatch,
  cssArtifactComplete,
  exclamation,
})

export type Messages = ReturnType<typeof getMessages>
