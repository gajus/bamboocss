import type { Config } from '@bamboocss/types'
import * as p from '@clack/prompts'
import { version } from '../package.json'

/**
 * PostCSS is not a Bamboo styling integration. Kept so existing callers still compile, and
 * always answers no.
 */
export const suggestPostcss = (_cwd: string) => 'no' as const

export const interactive = async (_options: { cwd?: string } = {}) => {
  p.intro(`bamboo v${version}`)

  const initFlags = await p.group(
    {
      useMjsExtension: () =>
        p.select({
          message: 'Use the mjs extension ?',
          initialValue: 'yes',
          options: [
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ],
        }),
      withStrictTokens: () =>
        p.select({
          message: 'Must every style value be a token?',
          // A misspelled token is reported by the build either way, so this asks only about the
          // policy — and a project that answers yes is committing every raw value to `[14px]`.
          initialValue: 'no',
          options: [
            { value: 'no', label: 'No — raw css values are fine' },
            { value: 'yes', label: 'Yes — every raw value is written `[14px]`' },
          ],
        }),
      shouldUpdateGitignore: () =>
        p.select({
          message: 'Update gitignore?',
          initialValue: 'yes',
          options: [
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ],
        }),
    },
    {
      // On Cancel callback that wraps the group
      // So if the user cancels one of the prompts in the group this function will be called
      onCancel: () => {
        p.cancel('Operation cancelled.')
        process.exit(0)
      },
    },
  )

  p.outro("Let's get started! 🎋")

  return {
    postcss: false,
    outExtension: initFlags.useMjsExtension === 'yes' ? 'mjs' : 'js',
    strictValues: strictValuesFrom(initFlags.withStrictTokens),
    gitignore: initFlags.shouldUpdateGitignore === 'yes',
  } satisfies InitFlags
}

/** `'yes'` is the historical spelling of `true`. */
const strictValuesFrom = (answer: string): Config['strictValues'] | undefined => (answer === 'yes' ? true : undefined)

interface InitFlags {
  postcss: boolean
  /** The two the prompt offers, rather than `string`, which is what the config accepts. */
  outExtension: 'mjs' | 'js'
  /**
   * Declared, which it was not.
   *
   * The old shape returned this field and omitted it from the interface, behind an
   * `as InitFlags` cast. `satisfies` catches that half — returning a field the interface does
   * not declare is now an error where the cast was silent. It does not catch the other half,
   * a field declared everywhere and read nowhere, which is what actually dropped the answer:
   * `InitCommandFlags` naming it, and the caller's `options` being typed rather than `{}`, are
   * what close that.
   */
  strictValues: Config['strictValues'] | undefined
  gitignore: boolean
}
