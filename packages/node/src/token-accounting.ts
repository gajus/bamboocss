import type { BambooContext } from './create-context'
import { type SourceSnapshot, sourceSnapshots } from './source-snapshots'

/**
 * Every reason the accounting can decline, as a union so the split below is exhaustive.
 *
 * `reason: string` let a newly added reason default silently into the failing half, with no
 * compiler help. That is the wrong direction for a decision that fails builds.
 */
export type DeclineReason =
  | 'unreadable'
  | 'transformed'
  | 'unparsed'
  | 're-exported'
  | 'import-equals'
  | 'require'
  | 'dynamic-import'
  | 'unclassified-import'
  | 'unsupported-import'
  | 'unresolved-reference'

/**
 * The one decline `prune.unresolvedPath: 'error'` fails the build on.
 *
 * That setting asserts that every token path resolves, and this is the reason that says otherwise:
 * a token binding used in a way the build cannot follow — a path built at runtime, a binding
 * assigned away, a namespace enumerated. It is about the author's *token usage*, and it has a
 * fix at the call site.
 *
 * Nothing else may throw, because nothing else is necessarily about tokens at all. The other
 * reasons were written under a premise this would break: declining was free, so every branch
 * that could not prove a shape declined, and the accepted set was kept deliberately small.
 * `import(`./pages/${name}`)` declines as `dynamic-import` because the specifier is not a
 * literal and *could* be the artifact; `import lexer = require('./tokenizer')` declines because
 * the statement contains the substring `token`. Both are routine code with nothing to do with
 * design tokens, and failing a build over them would be indefensible. They keep every
 * declaration, which is what they always did, and say so.
 */
export const failsStrict = (entry: DeclinedReference) => entry.reason === 'unresolved-reference'

/** A reference the accounting could not resolve, and where to find it. */
export interface DeclinedReference {
  filePath: string
  line: number
  reason: DeclineReason
  /** Exact source range when the decline belongs to one syntax node. */
  start?: number
  end?: number
}

export interface TokenAccounting {
  /** Token paths every accepted reference asks for. Recorded by the code that accepted them. */
  paths: Set<string>
  /**
   * Prefixes a reference is bounded by without naming one token.
   *
   * A template literal with a static head — `` token(`colors.${shade}`) `` — cannot say which
   * token it wants, but it can say which it *cannot*: whatever it resolves to begins
   * `colors.`. Keeping that category is a far smaller answer than keeping every declaration,
   * which is what declining the reference would have cost, and it is still a superset of
   * anything the expression can produce.
   */
  prefixes: Set<string>
  /** Everything that could not be resolved. Non-empty means the blanket keep has to stay. */
  declined: DeclinedReference[]
}

/**
 * Account for every way javascript can reach a token, under `include`.
 *
 * This exists to answer one question: can the token layer be pruned to what is actually asked
 * for, or does a path the build cannot read mean every declaration has to survive? `token()`
 * hands back a `var()` for every token, so an unreadable path could name any of them, and a
 * declaration that goes while the app still asks for it produces a `var()` with nothing behind
 * it — the guaranteed-invalid value, which inherits rather than falling back. Silently wrong.
 *
 * Two properties make that safe to act on:
 *
 * - **Accepted implies recorded.** The code that accepts a reference records its path in the
 *   same step, so there is no second derivation to disagree with. An earlier attempt at this
 *   accepted shapes from the syntax tree while a separate text regex built the keep set; the
 *   regex needed the literal identifier `token`, so `import { token as t }` then
 *   `t('colors.red.300')` was accepted and kept nothing, and the declaration went while the
 *   app asked for it. Recording at the point of acceptance is what makes that unrepresentable.
 * - **Declining is free.** A decline keeps every declaration, which is exactly what happens
 *   today. So every branch that cannot prove a shape declines, and the accepted set below is
 *   deliberately small.
 *
 * What it cannot see is a caller *outside* `include`, which scopes style extraction rather than
 * everything that may import — a script, a config, a sibling workspace package consuming the
 * output as design tokens. Nothing here declines for those, because nothing here can see them, so
 * no fallback covers them either: `prune.keepTokens` is the only answer, and `prune.unresolvedPath`
 * is what makes the declines this *can* see visible.
 *
 * That blind spot used to be covered by accident. The old default kept every declaration the
 * moment any javascript reached for a token at all, so a project with one `token()` call in it
 * protected its out-of-`include` readers without meaning to — and a project with none did not.
 * Consistency in the pruning direction is the trade this made deliberately.
 */
export function accountTokenReferences(ctx: BambooContext): TokenAccounting {
  const accounting: TokenAccounting = { paths: new Set<string>(), prefixes: new Set<string>(), declined: [] }

  for (const snapshot of sourceSnapshots(ctx)) {
    accountSnapshot(ctx, snapshot, accounting)
  }

  return accounting
}

/**
 * One file's contribution, split out so the build can account and scan in a single walk.
 *
 * `pruneTokensForBuild` needs the keep set, the reachability answer and this accounting from
 * the same files; three separate passes read every file three times.
 */
export function accountSnapshot(ctx: BambooContext, snapshot: SourceSnapshot, accounting: TokenAccounting) {
  const { filePath, onDisk, parsed } = snapshot
  const { paths, prefixes, declined } = accounting

  {
    // The syntax pass can only speak for a file it reads exactly as the bundler will compile
    // it. `parser:before` fires for every non-json file, and a single-file component is stored
    // *post-transform* — `vueToTsx` keeps only `<script setup>` when both blocks are present,
    // and both plugins return an empty string when the parse throws — so the copy the ast
    // would see is not the copy that ships. Extension is no guard either: a user hook can
    // rewrite a `.ts` file just as well.
    if (onDisk == null || parsed == null || parsed !== onDisk) {
      // A file with no token in either copy cannot reach the artifact, so there is nothing to
      // decline over. Checked here rather than up front because the text is all this branch
      // has — the tree is the wrong copy or missing.
      const mentions = mentionsToken(ctx, onDisk) || mentionsToken(ctx, parsed)
      if (!mentions) return

      declined.push({ filePath, line: 1, reason: onDisk == null || parsed == null ? 'unreadable' : 'transformed' })
      return
    }

    // A file that cannot name the artifact has nothing to account for, and the walk below costs
    // a full identifier traversal to discover that. It is the common case by a wide margin —
    // `sandbox/vite-ts` has six files under `include` and not one of them spells `token` — and
    // paying for it everywhere is what made the accounting look like something to opt into.
    //
    // Asked *before* the syntax check below, which is a round trip to the compiler. Both
    // branches under that check return without recording anything for a file that cannot name
    // the artifact, so ordering the cheap test first decides the same thing without asking. On
    // one real application 195 of 6,868 files spell `token`, and the other 6,673 were each
    // costing a request that could not change the outcome.
    if (!mentionsToken(ctx, parsed)) return

    // The walk itself is Rust's (`accountTokens`): it reads the same text the bundler compiles,
    // with Oxc's scope analysis deciding exactly which `token` references are the artifact.
    //
    // Matching text is not the same as a usable tree. A file that does not parse gives no
    // trustworthy answer about any call below its first error, so it declines as a whole — the
    // coarse direction is the safe one, and the report says which file to look at.
    const native = ctx.accountTokens(filePath, parsed)
    if (native.unparsed) {
      declined.push({ filePath, line: 1, reason: 'unparsed' })
      return
    }

    for (const path of native.paths) paths.add(path)
    for (const prefix of native.prefixes) prefixes.add(prefix)
    for (const entry of native.declined) declined.push({ filePath, ...entry })
  }
}

/**
 * Whether a file is worth walking — because it can name the artifact, or because a shape in it
 * declines without naming one.
 *
 * The obvious half is the substring `token`, which an import of the default entrypoint, a call,
 * a member read and a `require` of it all put in the source. Three things defeat it, and each one
 * is a silent under-keep rather than a slow build, so the test errs wide:
 *
 * - **A configured entrypoint need not spell it.** `importMap: { tokens: '@acme/design' }` and a
 *   tsconfig path mapping both make `isTokensEntrypoint` true for a specifier with no `token` in
 *   it, so the configured modules are tested for as well.
 * - **An identifier may be written with unicode escapes.** An import specifier can spell the `t`
 *   of `token` as a backslash-u escape and still bind the export, which `nameOf` resolves and
 *   there is a test on. Both escape forms — the four-digit one and the braced one — begin with a
 *   backslash followed by `u`, so testing for that pair catches every spelling.
 * - **`require()` and `import()` decline on a specifier this cannot read**, which is a statement
 *   about the specifier rather than about tokens: `import(`./pages/${name}`)` names nothing and
 *   declines all the same, because it *could* be the artifact. Skipping the file would drop that
 *   decline and with it the keep it was standing in for.
 *
 * A false positive costs one identifier walk. A false negative deletes a declaration something
 * still asks for, so anything uncertain belongs on the walking side.
 */
const IMPORTING_CALL = /\b(?:require|import)\s*\(/

const mentionsToken = (ctx: BambooContext, text: string | undefined | null) => {
  if (text == null) return false
  if (text.includes('token') || text.includes('\\u')) return true
  if (ctx.imports.value.tokens.some((mod) => text.includes(mod))) return true

  return IMPORTING_CALL.test(text)
}
