import type { Linter } from 'eslint'
import { rules } from '../rules'
import { RULE_NAME as FileNotIncluded } from '../rules/file-not-included'
import { RULE_NAME as NoConfigFunctionInSource } from '../rules/no-config-function-in-source'
import { RULE_NAME as NoInvalidTokenPaths } from '../rules/no-invalid-token-paths'
import { RULE_NAME as PreferShorthandProperties } from '../rules/prefer-shorthand-properties'

const errorRules: string[] = [FileNotIncluded, NoConfigFunctionInSource, NoInvalidTokenPaths]

/**
 * The opposite of a rule `all` turns on. `prefer-shorthand-properties` and
 * `prefer-longhand-properties` each fix what the other reports, and `--fix` reruns until nothing
 * changes, so with both on it renamed every such key back and forth. `all` keeps the longhand.
 */
const opposedRules: string[] = [PreferShorthandProperties]

/** A rule kept only so that a config naming it still loads, which turning on would do nothing. */
const isDeprecated = (name: string) => Boolean(rules[name as keyof typeof rules].meta.deprecated)

/** Every rule but those: an error where the build would be wrong, a warning otherwise. */
export const allRules: Linter.RulesRecord = Object.fromEntries(
  Object.keys(rules)
    .filter((name) => !opposedRules.includes(name) && !isDeprecated(name))
    .map((name) => [`bamboo/${name}`, errorRules.includes(name) ? 'error' : 'warn']),
)
