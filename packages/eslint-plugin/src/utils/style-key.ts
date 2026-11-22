import { getAncestor, isBambooAttribute, isRecipeVariant, isVariantOrPatternProperty, resolveLonghand } from './helpers'
import { isCallExpression } from './nodes'
import { type TSESLint, type TSESTree } from '@typescript-eslint/utils'
import { type RuleContext } from '@typescript-eslint/utils/ts-eslint'

type StyleProperty = TSESTree.Property & { key: TSESTree.Identifier; parent: TSESTree.ObjectExpression }

/**
 * The key of a style property, written as a name: what `prefer-longhand-properties` and
 * `prefer-shorthand-properties` read, and rename.
 *
 * Only a key the build reads as a property, since renaming anything else changes what the code
 * does. Not a recipe's variant — an axis or a variant where the recipe is declared, its call's
 * argument, `defaultVariants`, a compound variant's conditions — nor a property a pattern declares:
 * `rounded` there is the recipe's name for something, not `borderRadius`. Not a JSX attribute: with
 * the JSX factory gone, an attribute is a component's prop, never a style. And not a computed key,
 * which names whatever its expression holds, nor one being destructured.
 */
export const getStyleKey = (node: TSESTree.Property, context: RuleContext<any, any>) => {
  if (node.computed || node.key.type !== 'Identifier' || node.parent.type !== 'ObjectExpression') return
  const call = getAncestor(isCallExpression, node)
  if (!call || !isBambooAttribute(node, context)) return
  if (isRecipeVariant(node, context) || isVariantOrPatternProperty(node, context)) return
  return node as StyleProperty
}

/** A key as the object holds it, where the source spells it out. */
const keyName = (node: TSESTree.Property) => {
  const { key } = node
  if (key.type === 'Identifier') return node.computed ? undefined : key.name
  if (key.type === 'Literal') return typeof key.value === 'string' ? key.value : undefined
  if (key.type === 'TemplateLiteral' && key.expressions.length === 0) return key.quasis[0]?.value.cooked ?? undefined
}

/**
 * The fix writing a style key as `target`, another spelling of the property it names — or none
 * where another key in the same object names that property too. Renamed, the two would be one key
 * written twice, which TypeScript refuses, and which of them was meant is the author's to say.
 *
 * `{ bg }` reads a variable as well as naming the property, so it is written out, `background: bg`,
 * rather than renamed into reading another.
 */
export const renameStyleKey = (
  node: StyleProperty,
  target: string,
  context: RuleContext<any, any>,
): TSESLint.ReportFixFunction | undefined => {
  const propertyOf = (name: string) => resolveLonghand(name, context) ?? name
  const property = propertyOf(node.key.name)
  const clash = node.parent.properties.some((sibling) => {
    if (sibling === node || sibling.type !== 'Property') return false
    const name = keyName(sibling)
    return name !== undefined && propertyOf(name) === property
  })
  if (clash) return

  return node.shorthand
    ? (fixer) => fixer.replaceText(node, `${target}: ${node.key.name}`)
    : (fixer) => fixer.replaceText(node.key, target)
}
