---
'@bamboocss/parser': minor
'@bamboocss/node': minor
'@bamboocss/vite': minor
---

The Vite compiler and the stylesheet now compile against one context.

A project used to resolve its config twice per run: the CSS plugin through its `Builder`, the compiler through a
`loadConfigAndCreateContext` of its own. That meant two `BambooContext` objects and two complete ts-morph projects over
the same files, neither able to see what the other established — and a config edit reloaded only one of them, which is
why it had to restart the dev server rather than rebuild.

- `bamboocss()` creates one internal compilation host holding one lazy `Builder`. Both plugins take their context from
  it, `Builder.setup` runs once for the compiler's `enforce: 'pre'` `buildStart` and the CSS plugin's that follows, and
  the compiler re-derives its runtime `css` and style-set compiler whenever the Builder replaces its context.
- The compiler parses through a clone of the context's encoder, so folding a module adds no rule to the stylesheet.
  `Project.parseJson` now restores a dumped encoder into the encoder it was given rather than always into the context's.
- A transform's text is parsed under the file's own path only when ts-morph already holds exactly those bytes. Otherwise
  it goes to a sibling path, so a `pre` plugin's rewrite cannot become the source the next extraction pass reads. Those
  sibling parses resolve normally but are excluded from the ledger, the dependent walk and the unresolved-importer set.
- `Builder.reloadSource` and `Builder.removeSource` are how an integration sharing the context refreshes an edited
  source. They snapshot the resolution ledger before mutating, which is the graph the next pass needs to find the file's
  dependents.

One project instead of two: website builds measured 1.77–2.02 GB peak RSS against 2.11 GB before.
