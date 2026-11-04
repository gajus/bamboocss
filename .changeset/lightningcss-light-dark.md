---
'@bamboocss/plugin-lightningcss': patch
---

`pluginLightningcss()` leaves `light-dark()` as written, so `color-scheme: dark` on a subtree — the toggle the docs give
— switches the semantic tokens folded into it again. For any target older than Chrome 123, `defaults` among them,
LightningCSS rewrote each such token to `var(--lightningcss-light, …) var(--lightningcss-dark, …)`, and a custom
property substitutes those where it is declared: every token was settled once, at the root. No subtree toggle applied,
and a root one did only when the application's own rule had gone through LightningCSS too, and then it turned light
subtrees dark as well.

Browsers older than the baseline no longer get the polyfill. The baseline already requires `light-dark()`, and the
default PostCSS optimizer never lowered it. Everything else is still lowered against the targets, including the colors
inside a `light-dark()`.
