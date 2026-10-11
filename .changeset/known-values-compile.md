---
'@bamboocss/node': patch
---

Compile style values the build knows, instead of failing them as `dynamic` with nothing to say why.

- A default for an option or argument nobody passed: `o.display ?? 'block'`, `o.display || 'block'`,
  `o.dense ? '2' : '4'`, or an `if (o.dense)` in a helper called as `box()`. `undefined` decides a choice as surely as a
  value does.
- A property read off an object whose other properties the build cannot evaluate: `theme.radius` beside
  `shadow: computeShadow()`, whether the object is local or imported, the property nested, destructured
  (`const { radius } = theme`) or read with a literal key. A property a later spread or computed key may replace stays
  unknown.
- A property read no longer carries its siblings' undecided values, which also wrote their rules into the stylesheet.
