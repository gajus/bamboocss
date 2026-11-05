---
'@bamboocss/preset-base': patch
---

A color with an opacity modifier is written as the `color-mix()` it stands for: `bg: 'red.300/40'` is
`background: color-mix(in srgb, var(--colors-red-300) 40%, transparent)`. It went through a variable of its own,
`--mix-background`, read back as `var(--mix-background, var(--colors-red-300))`, on the claim that the color stood in
where `color-mix()` is not supported. It never did: the variable holds `color-mix()` unread either way, so the fallback
never applied, and each mixed declaration was written twice. Three of them, minified, go from 510 bytes to 324.

A color with an opacity modifier is now one declaration, so it takes a `fallback()` like any other value:
`bg: 'fallback(red.300/40, red.300)'` writes the plain color first, for a browser without `color-mix()`, which it
refused before.
