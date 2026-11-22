import { createRule } from '../utils'
import {
  getAncestor,
  isBambooAttribute,
  isBambooProp as isBambooProperty,
  isKeyframesName,
  isRecipeCall,
  isRecipeVariant,
  isVariantSelection,
} from '../utils/helpers'
import { isCallExpression, isIdentifier, isJSXExpressionContainer, isMemberExpression } from '../utils/nodes'
import { type TSESTree } from '@typescript-eslint/utils'

export const RULE_NAME = 'no-property-renaming'

const rule = createRule({
  create(context) {
    // Caches for helper functions
    const bambooPropertyCache = new WeakMap<TSESTree.JSXAttribute, boolean | undefined>()
    const bambooAttributeCache = new WeakMap<TSESTree.Property, boolean | undefined>()
    const recipeVariantCache = new WeakMap<TSESTree.Property, boolean | undefined>()

    const isCachedBambooProperty = (node: TSESTree.JSXAttribute): boolean => {
      if (bambooPropertyCache.has(node)) {
        return bambooPropertyCache.get(node)!
      }

      const result = isBambooProperty(node, context)
      bambooPropertyCache.set(node, result)
      return Boolean(result)
    }

    const isCachedBambooAttribute = (node: TSESTree.Property): boolean => {
      if (bambooAttributeCache.has(node)) {
        return bambooAttributeCache.get(node)!
      }

      const result = isBambooAttribute(node, context)
      bambooAttributeCache.set(node, result)
      return Boolean(result)
    }

    const isCachedRecipeVariant = (node: TSESTree.Property): boolean => {
      if (recipeVariantCache.has(node)) {
        return recipeVariantCache.get(node)!
      }

      const result = isRecipeVariant(node, context)
      recipeVariantCache.set(node, result)
      return Boolean(result)
    }

    const sendReport = (node: TSESTree.Node, expected: string, property: string) => {
      context.report({
        data: {
          expected,
          prop: property,
        },
        messageId: 'noRenaming',
        node,
      })
    }

    const handleReport = (node: TSESTree.Node, value: TSESTree.Node, attribute: string) => {
      // A keyframes name is no prop: `animationName: fadeIn` reads the name `keyframes()` returned.
      if (isKeyframesName(value, context)) return

      if (isIdentifier(value) && attribute !== value.name) {
        sendReport(node, attribute, value.name)
      } else if (isMemberExpression(value) && isIdentifier(value.property) && attribute !== value.property.name) {
        sendReport(node, attribute, value.property.name)
      }
    }

    return {
      JSXAttribute(node: TSESTree.JSXAttribute) {
        if (!node.value) {
          return
        }

        if (!isJSXExpressionContainer(node.value)) {
          return
        }

        if (!isCachedBambooProperty(node)) {
          return
        }

        const attribute = node.name.name.toString()
        const expression = node.value.expression

        handleReport(node.value, expression, attribute)
      },

      Property(node: TSESTree.Property) {
        if (!isIdentifier(node.key)) {
          return
        }

        if (!isIdentifier(node.value) && !isMemberExpression(node.value)) {
          return
        }

        if (!isCachedBambooAttribute(node)) {
          return
        }

        if (isCachedRecipeVariant(node)) {
          return
        }

        // A variant being selected is no prop to track: a recipe call reads any value it is handed,
        // `cardStyle({ rounded: isRounded })`, and a declaration's selections are its own to make.
        const call = getAncestor(isCallExpression, node)
        if (isVariantSelection(node) || (call && isRecipeCall(call, context))) {
          return
        }

        const attribute = node.key.name
        const value = node.value

        handleReport(node.value, value, attribute)
      },
    }
  },
  defaultOptions: [],
  meta: {
    docs: {
      description:
        'Ensure that properties for patterns or style props are not renamed, as it prevents proper tracking.',
    },
    messages: {
      noRenaming:
        'Incoming `{{prop}}` prop is different from the expected `{{expected}}` attribute. Bamboo will not track this prop.',
    },
    schema: [],
    type: 'problem',
  },
  name: RULE_NAME,
})

export default rule
