import { definePreset, defineUtility } from '@bamboocss/dev'
import type { BambooPlugin, PropertyTransform, TransformArgs, UserConfig, UtilityConfig } from '@bamboocss/dev'
import { expect, expectTypeOf, test } from 'vitest'

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
