---
'@bamboocss/core': patch
---

Rules of equal specificity under two conditions are ordered by the states their selectors require, read by name. The
state used to be found by searching the selector's text, and it went wrong four ways:

- `&:has(> input:focus)` always beat `&:has(> input[aria-invalid=true])`, for the `:focus` of another element. A state
  inside `:has()` or `:nth-child(… of …)` no longer ranks a rule.
- `_hover` always beat `&:is(:focus, :active)`, because a list ranked as its weakest state. It ranks as its strongest.
- `:focus-visible` ranked as `:focus`, so `_focus` against `_focusVisible` went to whichever rule the build saw first.
  `_focusVisible` wins now.
- Nested conditions ranked by their first, so `_hover: { _active }` against `_hover: { _focus }` went to whichever the
  build saw first, and under an at-rule the order they were nested in decided. They rank by every state they require,
  and the `_active` one wins.

States under a selector of your own, such as a part selector wrapping a recipe's conditions, were never ranked for the
last reason. They are now, so `_active` beats `_dark` there as it does everywhere else.
