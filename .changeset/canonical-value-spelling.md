---
'@bamboocss/core': minor
---

Derive an atom's identity from a canonical value spelling, so one declaration is one class.

An atom's identity came from the value as it was _written_, while the sheet ships the value as it was _optimized_. Those
are different strings, so two spellings of one value minted two atoms that became byte-identical only after minification
— long after the class names were compiled into the bundle. Measured on one production sheet: 288 of 4,578 atoms were
redundant this way, with `background:#fff` carrying three class names and `box-shadow:-2px 5px 12px #0000001a` five.

The value is now folded to one spelling before it becomes either a cache key or a transform input, so the class name and
the declaration agree by construction. `#fff`, `#ffffff` and `#FFFFFF` are one atom; so are `0.15s` and `.15s`, and
`'0  16px'` and `'0 16px'`.

**This changes emitted CSS.** Values written without a leading zero gain one, and hex colours are lowercased and
contracted:

- `transition: all .3s ease-in-out` → `all 0.3s ease-in-out`
- `rgb(200 200 200 / .4)` → `rgb(200 200 200 / 0.4)`
- `rgba(0,0,0,.02)` → `rgba(0,0,0,0.02)`

All of these are the same value, and the optimizer strips the zero again on the way out, so nothing reaches the browser
larger. Class names change for the affected values only — `trs_all_.3s_ease-in-out` becomes `trs_all_0.3s_ease-in-out` —
which under `hash: true` means those names are new and their cached stylesheet is stale once.

The fold is deliberately lexical. It rewrites spellings that denote the same token and never converts between forms:
`rgba(0, 0, 0, 0.1)` is not folded to `#0000001a`, and `150ms` is not folded to `0.15s`. Those conversions belong to the
optimizer, whose choices differ between the PostCSS and Lightning CSS paths — deriving a class name from them would make
the name depend on which optimizer a project installed. A value containing a quoted string or a `url()` is left exactly
as written.
