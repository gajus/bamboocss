import { createRule } from '../utils'
import {
  getAncestor,
  isInBambooFunction,
  isBambooAttribute,
  isBambooProp as isBambooProperty,
  isCssCall,
  isKeyframesName,
  isRecipeVariant,
  readsBambooBinding,
  resolveReference,
} from '../utils/helpers'
import {
  isArrayExpression,
  isCallExpression,
  isIdentifier,
  isJSXExpressionContainer,
  isLiteral,
  isObjectExpression,
  isTemplateLiteral,
} from '../utils/nodes'
import { type TSESTree } from '@typescript-eslint/utils'

export const RULE_NAME = 'no-dynamic-styling'

/** `node` without the TypeScript written around it, which the compiler reads a value through. */
const unwrap = (node: TSESTree.Node): TSESTree.Node => {
  let current = node
  while (
    current.type === 'TSAsExpression' ||
    current.type === 'TSSatisfiesExpression' ||
    current.type === 'TSNonNullExpression' ||
    current.type === 'TSTypeAssertion'
  ) {
    current = current.expression
  }
  return current
}

/**
 * The choices — `test ? a : b` — a `css()` call's arguments hold, in the order they are written: as
 * an argument, as a value in its objects, and within the answers of another. `open` is a spread, a
 * computed key, a method, an accessor or `__proto__` in an object outside every answer, which leaves
 * the compiler no way to write out what each answer sets.
 */
interface Choices {
  found: TSESTree.ConditionalExpression[]
  open: boolean
}

const collectChoices = (node: TSESTree.Node, choices: Choices, inAnswer: boolean) => {
  const value = unwrap(node)
  if (value.type === 'ConditionalExpression') {
    choices.found.push(value)
    collectChoices(value.consequent, choices, true)
    collectChoices(value.alternate, choices, true)
    return
  }
  if (value.type !== 'ObjectExpression') return
  for (const property of value.properties) {
    if (property.type !== 'Property') {
      if (!inAnswer) choices.open = true
      continue
    }
    const { key } = property
    const proto =
      !property.computed &&
      ((key.type === 'Identifier' && key.name === '__proto__') || (key.type === 'Literal' && key.value === '__proto__'))
    if (!inAnswer && (property.computed || property.method || property.kind !== 'init' || proto)) choices.open = true
    collectChoices(property.value, choices, inAnswer)
  }
}

/** Each call's choices, read once however many of them its keys report. */
const choicesCache = new WeakMap<TSESTree.CallExpression, Choices>()

const choicesOf = (call: TSESTree.CallExpression) => {
  let choices = choicesCache.get(call)
  if (!choices) {
    choices = { found: [], open: false }
    for (const argument of call.arguments) collectChoices(argument, choices, false)
    choicesCache.set(call, choices)
  }
  return choices
}

const rule = createRule({
  create(context) {
    // Helper function to determine if a node represents a static value
    function isStaticValue(node: null | TSESTree.Node | undefined): boolean {
      if (!node) {
        return false
      }

      node = unwrap(node)

      if (isLiteral(node)) {
        return true
      }

      // A negative number is written as one, `zIndex: -1`, though it parses as `-` applied to `1`.
      if (
        node.type === 'UnaryExpression' &&
        (node.operator === '-' || node.operator === '+') &&
        isLiteral(node.argument) &&
        typeof node.argument.value === 'number'
      ) {
        return true
      }

      // A keyframes name is replaced by the name the build writes in its place, alone or in a template:
      // `${fadeIn} 0.2s ease-out`.
      if (isTemplateLiteral(node)) {
        return node.expressions.every((expression) => isKeyframesName(expression, context))
      }

      if (isKeyframesName(node, context)) {
        return true
      }

      if (isObjectExpression(node)) {
        return true
      } // Conditions are acceptable

      return false
    }

    // An array is not a style value: the runtime throws on one and the compiler fails the build.
    // It used to be read as one value per breakpoint, which is why this rule once accepted an
    // array of literals — the one shape that now always fails. A list of mixins is the exception,
    // `mixin: ['body', 'muted']`, names applied in order, each as static as any value has to be.
    function reportArray(array: TSESTree.ArrayExpression, mixin: boolean) {
      if (!mixin) {
        context.report({
          messageId: 'array',
          node: array,
        })
        return
      }

      for (const element of array.elements) {
        if (element && element.type !== 'SpreadElement' && isStaticValue(element)) continue
        context.report({
          messageId: 'dynamic',
          node: element ?? array,
        })
      }
    }

    /** Whether `node` is a `mixin`, or a condition choosing one: `mixin: { md: ['lead', 'muted'] }`. */
    function isMixinValue(node: TSESTree.Property): boolean {
      for (let current: TSESTree.Node | undefined = node; current?.type === 'Property'; ) {
        if (!current.computed && isIdentifier(current.key) && current.key.name === 'mixin') return true
        const object: TSESTree.Node | undefined = current.parent
        if (object?.type !== 'ObjectExpression') return false
        current = object.parent
      }
      return false
    }

    /** `undefined` as written, which `css()` drops with the key it is the value of. */
    const isUndefined = (node: TSESTree.Node) =>
      isIdentifier(node) && node.name === 'undefined' && !resolveReference(node, context)

    /**
     * A choice between two styles, written as a style value: `css({ padding: compact ? '2' : '4' })`.
     *
     * The compiler compiles one per `css()` call, in a call taking one object with every key of it
     * written out, to its test choosing between the class strings of its two answers. So the test is
     * copied, and may read anything but a binding of bamboo's, and each answer is a style value like
     * any other. Anywhere else a choice is a dynamic value: a pattern, a recipe and `css.raw()`
     * compile none.
     */
    function reportChoice(choice: TSESTree.ConditionalExpression) {
      const call = getAncestor(isCallExpression, choice)
      const choices = call && isCssCall(call, context) ? choicesOf(call) : undefined
      if (!call || !choices?.found.includes(choice)) {
        context.report({ messageId: 'dynamic', node: choice })
        return
      }
      if (call.arguments.length > 1 || choices.open || choices.found[0] !== choice) {
        context.report({ messageId: 'choice', node: choice })
        return
      }
      if (readsBambooBinding(choice.test, context)) {
        context.report({ messageId: 'choiceTest', node: choice.test })
        return
      }
      for (const answer of [choice.consequent, choice.alternate]) {
        // A choice within this one, which no key of its own reports.
        if (unwrap(answer).type === 'ConditionalExpression') context.report({ messageId: 'choice', node: answer })
        else if (!isStaticValue(answer) && !isUndefined(answer)) context.report({ messageId: 'dynamic', node: answer })
      }
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
            reportArray(expr, node.name.type === 'JSXIdentifier' && node.name.name === 'mixin')
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

        const value = unwrap(node.value)
        if (value.type === 'ConditionalExpression') {
          reportChoice(value)
          return
        }

        if (isStaticValue(node.value)) {
          return
        }

        if (isArrayExpression(node.value)) {
          reportArray(node.value, isMixinValue(node))
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
      choice:
        'A css() call compiles one choice, and only in a call taking one object with every key written out. Give this one a css() call of its own and join the calls with cx().',
      choiceTest:
        'A choice compiles to its test, copied into the compiled call, which holds no Bamboo import or recipe for it to read.',
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
