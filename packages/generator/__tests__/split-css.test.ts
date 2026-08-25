import { fixtureDefaults } from '@bamboocss/fixture'
import type { LoadConfigResult, StaticCssOptions } from '@bamboocss/types'
import { describe, expect, test } from 'vitest'
import { Generator } from '../src'

const createSplitCssContext = (staticCss: StaticCssOptions) => {
  const config: LoadConfigResult = {
    ...fixtureDefaults,
    config: {
      ...fixtureDefaults.config,
      staticCss,
    },
  }

  const generator = new Generator(config)
  const sheet = generator.createSheet()

  generator.appendLayerParams(sheet)
  generator.appendBaselineCss(sheet, { atomizeRecipes: true })

  return { sheet, artifacts: generator.getSplitCssArtifacts(sheet) }
}

describe('split CSS generation', () => {
  test('atomizes statically included recipes into utilities', () => {
    const { sheet, artifacts } = createSplitCssContext({ recipes: '*' })
    const utilities = artifacts.layers.find((artifact) => artifact.name === 'utilities')

    expect(utilities?.code).toContain('.d_flex')
    expect(sheet.getLayerCss('recipes').trim()).toBe('')
  })

  test('omits the obsolete recipe layer from the split index', () => {
    const { artifacts } = createSplitCssContext({ recipes: '*' })

    expect(artifacts.index).toContain('@layer reset, base, tokens, utilities;')
    expect(artifacts.index).not.toContain('recipes')
  })
})
