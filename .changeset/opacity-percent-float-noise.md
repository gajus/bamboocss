---
'@bamboocss/token-dictionary': patch
'@bamboocss/core': patch
---

Emit an opacity token as an exact percentage in `color-mix()`.

The percentage was computed as `value * 100` in floating point, so an opacity token of `0.07` reached the stylesheet as
`7.000000000000001%` and `0.29` as `28.999999999999996%`. It is now rounded to twelve significant digits — far beyond
what a color can resolve — giving `7%` and `29%`. Values that were already exact, such as `0.5` or `0.125`, are
unchanged.
