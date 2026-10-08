---
'@bamboocss/preset-base': patch
---

Write vendor-prefixed declarations before the standard ones, so `backdropFilter` survives Vite 8's default CSS minifier.

- LightningCSS, which Vite 8 uses to minify CSS by default and `pluginLightningcss()` runs, kept only
  `-webkit-backdrop-filter` when it followed `backdrop-filter`. Chrome, Edge and Firefox support only the standard
  property, so backdrop blur rendered in Safari alone, in production builds only.
- Every utility that writes a pair now puts the prefixed declaration first and the standard one last, so the standard
  one also applies wherever both are understood: `appearance`, `backdropFilter`, `backfaceVisibility`, `backgroundClip`,
  `boxDecorationBreak`, `clipPath`, `hyphens`, `mask`, `maskImage`, `maskSize` and `textSizeAdjust`. The reset's
  `appearance: button` rule changes order the same way. Only declaration order changes.
