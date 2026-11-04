---
'@bamboocss/core': patch
---

A number written as a string, such as `padding: '1e3'`, `'+2'` or `'-0'`, is named as the number it reads as. The
stylesheet read the value back as a number and wrote its rule for `p_1000`, while the compiler put `p_1e3` on the
element, so the build failed with a compiled class that had no rule.
