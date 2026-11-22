---
'@bamboocss/eslint-plugin': patch
---

Stop linting a recipe's or a pattern's argument as CSS. A key there named as a style was checked as one:

- `no-invalid-token-paths` reported `link({ color: 'shark' })`, where `color` is a `link` variant, as naming no `colors`
  token, `flex({ direction: 'column' })` as an invalid CSS `direction`, though the pattern writes `flexDirection`, and a
  recipe's `defaultVariants` and compound variant conditions the same way.
- `no-dynamic-styling` reported a variant chosen at run time, `table({ size, verticalAlign })`, which the compiler
  compiles to a lookup of every combination. A variant named at run time, `table({ [key]: 'sm' })`, is still reported,
  and so is a runtime value handed to a pattern, which does not compile.
- `no-property-renaming` reported `cardStyle({ rounded: isRounded })`: a recipe reads whatever value it is handed.
- `prefer-atomic-properties` suggested splitting a variant or a pattern's own prop, `panel({ padding: '4' })`, into
  properties neither would read.

A style handed to a pattern beside its own props, `flex({ direction: 'column', color: 'shark' })`, is still checked.
