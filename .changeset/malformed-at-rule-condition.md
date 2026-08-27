---
'@bamboocss/core': patch
---

Drop a malformed at-rule condition instead of crashing with a `TypeError`.

`parseAtRule` read the parsed node straight off the root:

```ts
const result = safeParse(value)
const rule = result.nodes[0] as AtRule
return { name: rule.name /* ... */ }
```

`safeParse` exists so malformed CSS does not throw — it answers a parse error with an empty root. Reading `nodes[0]` off
that root handed back `undefined`, and the cast said otherwise, so the next line raised
`TypeError: Cannot read properties of undefined (reading 'name')`.

postcss rejects more `@`-strings than it looks like it would. `@`, `@;`, `@}`, `@ media` and `@media {` are all parse
errors, and each reached this path because `parseCondition` routes anything starting with `@` here.

Where it surfaced depended on the caller. `Conditions.getRaw` wraps the call and logged a warning, so an inline query
degraded quietly. The constructor and `saveOne` do not, so a typo'd condition in a project's config crashed context
construction with a message naming neither the condition nor the file it came from.

An unparseable condition is now dropped and reported with its key. Dropped rather than stored as `undefined`: `has`
answers from `hasOwnProperty`, so a retained entry would report as present and then hand its `undefined` to
`getSortedKeys`, whose `flatten` reads `.type` off every condition — one crash traded for a later one.

The node is now checked for being an at-rule rather than merely present, so a `@`-string postcss parses into some other
node type is dropped on the same path instead of producing a condition with an `undefined` name.

A config whose conditions all parse sees no change.
