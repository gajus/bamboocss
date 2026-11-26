---
'@bamboocss/node': patch
'@bamboocss/vite': patch
---

Compile only the combinations of a `cx()` call's conditions that a value can reach. Conditions comparing one value with
different literals were treated as independent, so
`cx(base, variant === 'secondary' && secondary, variant === 'ghost' && ghost)` wrote out a class string for `variant`
being both, and a component comparing one prop with each of its values doubled what it compiled to at every comparison.
Six such comparisons were sixty-four combinations, past the thirty-two a call compiles to, and the call was left to the
runtime `cx`.

A condition the answers before it have decided is no longer asked: where `size === 'sm'` answered yes, `size === 'lg'`
is not asked, and neither is `!active` where `active` was. This holds for a value read as it is (`size`, `props.size`),
tested or negated, or compared with a literal by `===` or `!==`, and stops at a condition that could run something, such
as a call, which may change what a later one answers. A `css()` call holding choices is decided the same way, within the
call and by the conditions of a `cx()` composing it.
