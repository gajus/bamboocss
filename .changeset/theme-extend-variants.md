---
'@bamboocss/config': patch
---

Apply theme variants declared under `theme.extend.variants`. The option is typed beside `theme.variants.extend`, but the
config merge rebuilt `theme.variants` from `theme.variants` alone and dropped them with no error: the variant's tokens
were never declared, and an element under its `[data-bamboo-theme=name]` root kept the base values. Both spellings now
extend the variants the presets and other configs declare, merged the same way.
