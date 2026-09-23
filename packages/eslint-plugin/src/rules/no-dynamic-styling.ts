import { createRule } from '../utils'
import {
  isInBambooFunction,
  isBambooAttribute,
  isBambooProp as isBambooProperty,
  isRecipeVariant,
} from '../utils/helpers'
import {
  isArrayExpression,
  isIdentifier,
  isJSXExpressionContainer,
  isLiteral,
  isObjectExpression,
  isTemplateLiteral,
} from '../utils/nodes'
import { type TSESTree } from '@typescript-eslint/utils'

export const RULE_NAME = 'no-dynamic-styling'

const rule = createRule({
  create(context) {
    // Helper function to determine if a node represents a static value
    function isStaticValue(node: null | TSESTree.Node | undefined): boolean {
      if (!node) {
        return false
      }

      if (isLiteral(node)) {
        return true
      }

      if (isTemplateLiteral(node) && node.expressions.length === 0) {
        return true
      }

      if (isObjectExpression(node)) {
        return true
      } // Conditions are acceptable

      return false
    }

    // An array is not a style value: the runtime throws on one and the compiler fails the build.
    // It used to be read as one value per breakpoint, which is why this rule once accepted an
    // array of literals — the one shape that now always fails.
    function reportArray(array: TSESTree.ArrayExpression) {
      context.report({
        messageId: 'array',
        node: array,
      })
    }

    return {
      // JSX Attributes
      JSXAttribute(node: TSESTree.JSXAttribute) {
        if (!node.value) {
          return
        }

        // Check if it's a Bamboo prop early to avoid unnecessary processing
        const isBamboo = isBambooProperty(node, context)
        if (!isBamboo) {
          return
        }

        // Static literals are fine
        if (isLiteral(node.value)) {
          return
        }

        if (isJSXExpressionContainer(node.value)) {
          const expr = node.value.expression

          if (isStaticValue(expr)) {
            return
          }

          if (isArrayExpression(expr)) {
            reportArray(expr)
            return
          }

          // Report dynamic value usage
          context.report({
            messageId: 'dynamic',
            node: node.value,
          })
        }
      },

      // Object Properties
      Property(node: TSESTree.Property) {
        if (!isIdentifier(node.key)) {
          return
        }

        // Check if it's a Bamboo attribute early to avoid unnecessary processing
        if (!isBambooAttribute(node, context)) {
          return
        }

        if (isRecipeVariant(node, context)) {
          return
        }

        if (isStaticValue(node.value)) {
          return
        }

        if (isArrayExpression(node.value)) {
          reportArray(node.value)
          return
        }

        // Report dynamic value usage
        context.report({
          messageId: 'dynamic',
          node: node.value,
        })
      },

      // Dynamic properties with computed keys
      'Property[computed=true]': (node: TSESTree.Property) => {
        if (!isInBambooFunction(node, context)) {
          return
        }

        context.report({
          messageId: isRecipeVariant(node, context) ? 'dynamicRecipeVariant' : 'dynamicProperty',
          node: node.key,
        })
      },
    }
  },
  defaultOptions: [],
  meta: {
    docs: {
      description:
        "Ensure users don't use dynamic styling. Prefer static styles, leverage CSS variables, or recipes for known dynamic styles.",
    },
    messages: {
      array:
        'An array is not a style value. Write a responsive value as a condition object, e.g. { base: "medium", lg: "bold" }.',
      dynamic: 'Remove dynamic value. Prefer static styles.',
      dynamicProperty: 'Remove dynamic property. Prefer static style property.',
      dynamicRecipeVariant: 'Remove dynamic variant. Prefer static variant definition.',
    },
    schema: [],
    type: 'problem',
  },
  name: RULE_NAME,
})

export default rule
