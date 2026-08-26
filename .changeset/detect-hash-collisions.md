---
'@bamboocss/core': minor
'@bamboocss/shared': minor
---

Fail the build when two declarations hash to the same class name, instead of shipping both.

Class names go through a 32-bit hash rendered into letters, so distinct declarations can land on the same name. Nothing
noticed. The stylesheet emitted two rules under one selector:

```css
.bRzHLW {
  transition: 192009px;
}
.bRzHLW {
  width: 114360px;
}
```

and both `css()` calls compiled to that same literal, so every element carrying it received a declaration its source
never mentions. Exit code 0, no warning — and undiagnosable from the symptom, which is a component styled by a property
that appears nowhere in its source.

The odds are per build and grow with the square of the atom count. Measured: the 6,254 distinct declarations in one
production sheet produce none, and a synthetic 100,000-atom set produces one, matching the birthday prediction — roughly
0.5% at 6,000 atoms, 5% at 20,000, 25% at 50,000. Rare enough never to have been reported, common enough to be someone's
afternoon.

Now it throws, naming both declarations rather than only the class they share. That is what this codebase already does
everywhere a name is derived twice and the two halves only meet in the DOM — see `checkNamingAgreement`, whose reasoning
is the same: failing now costs a build, not failing ships the wrong styles.

Only reachable under `hash: true`. Readable class names carry the declaration that produced them, so they are unique by
construction and are unaffected.

`toHash` itself is untouched and stays a pure, self-contained expression — `generateCva` and `generateRecipe` serialize
it into the styled-system runtime, so anything it closed over would be a free variable in the browser. The check is a
separate build-time step at the two sites that assign a name.
