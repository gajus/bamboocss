import { expect, expectTypeOf, test } from 'vitest'
import {
  definePreset,
  defineUtility,
  type BambooPlugin,
  type PropertyTransform,
  type TransformArgs,
  type UserConfig,
  type UtilityConfig,
} from '../src'

test('exports authoring types from the CLI package entry point', () => {
  const transform: PropertyTransform = (value, args) => {
    expectTypeOf(args).toEqualTypeOf<TransformArgs>()
    return { opacity: value }
  }
  const utilities: UtilityConfig = { faded: defineUtility({ transform }) }
  const preset = definePreset({ name: 'test-utilities', utilities })
  const config: UserConfig = { cwd: '.', include: ['src/**/*.tsx'], outdir: 'styled-system', presets: [preset] }
  expect(config.presets).toEqual([preset])
  expectTypeOf<NonNullable<UserConfig['plugins']>[number]>().toEqualTypeOf<BambooPlugin>()
})
