import { createRule } from '../utils'
import {
  getAncestor,
  isInBambooFunction,
  isBambooAttribute,
  isBambooProp as isBambooProperty,
  isCssCall,
  isKeyframesName,
  isRecipeCall,
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
 * an argument, as a value in its objects, and within the answers of another. `open` is a computed
 * key, a method, an accessor, `__proto__` or a spread of a choice in an object outside every answer,
 * or a spread of the call's arguments, which leave the compiler no way to write out what each
 * answer sets.
 */
interface Choices {
  found: TSESTree.ConditionalExpression[]
  open: boolean
  /** The combinations of answers the compiler writes out, counted no further than past its limit. */
  combinations: number
}

/** The most combinations of a call's choices the compiler writes out, one class string each. */
const MAX_COMBINATIONS = 32

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
    // A spread is merged where it is written: one the build knows compiles beside a choice, and one
    // holding a choice does not, as extraction cannot tell which properties either answer sets.
    if (property.type !== 'Property') {
      if (!inAnswer && unwrap(property.argument).type === 'ConditionalExpression') choices.open = true
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

/** `active` or `props.size`: a read with nothing to run, which the compiler asks once however often it is written. */
const plainRead = (node: TSESTree.Node): string | undefined => {
  const value = unwrap(node)
  if (value.type === 'Identifier') return value.name
  if (value.type === 'MemberExpression' && !value.computed && !value.optional && value.property.type === 'Identifier') {
    const object = plainRead(value.object)
    return object === undefined ? undefined : `${object}.${value.property.name}`
  }
  return undefined
}

/** The decision the compiler writes for a call's choices, by test: a leaf is `undefined`. */
type Decision = { test: string; then: Decision; otherwise: Decision } | undefined

const leavesOf = (decision: Decision): number => (decision ? leavesOf(decision.then) + leavesOf(decision.otherwise) : 1)

/** `second` on every path through `first`, each test a path answered taking its answer, as the compiler asks them. */
const sequence = (first: Decision, second: Decision, decided = new Map<string, boolean>()): Decision => {
  if (first) {
    decided.set(first.test, true)
    const then = sequence(first.then, second, decided)
    decided.set(first.test, false)
    const otherwise = sequence(first.otherwise, second, decided)
    decided.delete(first.test)
    return { test: first.test, then, otherwise }
  }
  if (!second) return undefined
  const answered = decided.get(second.test)
  if (answered !== undefined) return sequence(undefined, answered ? second.then : second.otherwise, decided)
  decided.set(second.test, true)
  const then = sequence(undefined, second.then, decided)
  decided.set(second.test, false)
  const otherwise = sequence(undefined, second.otherwise, decided)
  decided.delete(second.test)
  return { test: second.test, then, otherwise }
}

/**
 * How many combinations of answers the compiler writes out for `call`, counting no further than
 * past its limit: its choices in the order the call asks them, a plain read written twice asked once
 * where every test is one.
 */
const combinationsOf = (call: TSESTree.CallExpression, found: TSESTree.ConditionalExpression[]) => {
  const once = found.every((choice) => plainRead(choice.test) !== undefined)
  const keys = new Map<TSESTree.Node, string>()
  const keyOf = (choice: TSESTree.ConditionalExpression) => {
    let key = keys.get(choice)
    if (key === undefined) keys.set(choice, (key = (once && plainRead(choice.test)) || `#${keys.size}`))
    return key
  }
  let tooMany = false
  const decisionOf = (node: TSESTree.Node): Decision => {
    const value = unwrap(node)
    if (tooMany) return undefined
    if (value.type === 'ConditionalExpression') {
      const choice = { test: keyOf(value), then: decisionOf(value.consequent), otherwise: decisionOf(value.alternate) }
      const decision = sequence(choice, undefined)
      if (leavesOf(decision) > MAX_COMBINATIONS) tooMany = true
      return decision
    }
    if (value.type !== 'ObjectExpression') return undefined
    let decision: Decision
    for (const property of value.properties) {
      if (property.type !== 'Property') continue
      decision = sequence(decision, decisionOf(property.value))
      if (leavesOf(decision) > MAX_COMBINATIONS) tooMany = true
      if (tooMany) return undefined
    }
    return decision
  }
  let decision: Decision
  for (const argument of call.arguments) {
    decision = sequence(decision, decisionOf(argument))
    if (tooMany || leavesOf(decision) > MAX_COMBINATIONS) return MAX_COMBINATIONS + 1
  }
  return tooMany ? MAX_COMBINATIONS + 1 : leavesOf(decision)
}

/** Each call's choices, read once however many of them its keys report. */
const choicesCache = new WeakMap<TSESTree.CallExpression, Choices>()

const choicesOf = (call: TSESTree.CallExpression) => {
  let choices = choicesCache.get(call)
  if (!choices) {
    choices = { found: [], open: false, combinations: 1 }
    for (const argument of call.arguments) {
      // A spread of the arguments is one the compiler cannot write out.
      if (argument.type === 'SpreadElement') choices.open = true
      else collectChoices(argument, choices, false)
    }
    if (choices.found.length > 0 && !choices.open) choices.combinations = combinationsOf(call, choices.found)
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

    /** Calls reported for holding more combinations than the compiler writes out, once each. */
    const reportedCalls = new WeakSet<TSESTree.CallExpression>()

    /**
     * A choice between styles, written as a style value: `css({ padding: compact ? '2' : '4' })`.
     *
     * The compiler compiles a `css()` call's choices, beside one another, inside the answers of
     * another and beside a spread or a second argument, to their tests choosing between class
     * strings, one per combination of answers, up to 32. So each test is copied, and may read
     * anything but a binding of bamboo's, and each answer is a style value like any other. Anywhere
     * else a choice is a dynamic value: a pattern, a recipe's declaration and `css.raw()` compile none.
     * A recipe's call never reaches here, as it selects variants rather than styling anything.
     */
    function reportChoice(choice: TSESTree.ConditionalExpression) {
      const call = getAncestor(isCallExpression, choice)
      const choices = call && isCssCall(call, context) ? choicesOf(call) : undefined
      if (!call || !choices?.found.includes(choice)) {
        context.report({ messageId: 'dynamic', node: choice })
        return
      }
      if (choices.open) {
        context.report({ messageId: 'choice', node: choice })
        return
      }
      if (choices.combinations > MAX_COMBINATIONS) {
        if (reportedCalls.has(call)) return
        reportedCalls.add(call)
        context.report({ messageId: 'choices', node: choices.found[0]! })
        return
      }
      checkChoice(choice)
    }

    function checkChoice(choice: TSESTree.ConditionalExpression) {
      if (readsBambooBinding(choice.test, context)) {
        context.report({ messageId: 'choiceTest', node: choice.test })
        return
      }
      for (const answer of [choice.consequent, choice.alternate]) {
        const value = unwrap(answer)
        // A choice within this one, which no key of its own reports.
        if (value.type === 'ConditionalExpression') checkChoice(value)
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

        // A recipe call selects its variants at run time as readily as from a literal, `table({ size,
        // variant })`: the compiler looks the answer up in a table of every combination. A pattern is
        // not a recipe, and compiles only what it is given written out.
        const call = getAncestor(isCallExpression, node)
        if (call && isRecipeCall(call, context)) {
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
        'A css() call compiles its choices only where every key it is given is written out: no computed key, method, accessor or __proto__, and no spread of its arguments. Give this choice a css() call of its own and join the calls with cx().',
      choices:
        'A css() call compiles at most 32 combinations of its choices, one class string each. Make some of them variants of a recipe, which decides variants that style declarations of their own apart.',
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
