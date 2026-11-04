---
'@bamboocss/node': patch
---

A value imported from a file whose name has a dot before its extension, such as `./card.styles` for `card.styles.ts`,
resolves as TypeScript and Vite resolve it, and so does one imported through a `.jsx` specifier for a `.tsx` source.
Each import was read as unknown, so a call using the value was refused as dynamic and the build failed.
