---
'@bamboocss/vite': patch
---

Serve `virtual:bamboo.css?url` on the dev server. TanStack Start's template links its stylesheet through a `?url`
import, and linking Bamboo's stylesheet the same way failed the first server render.

A build already handled `?url`: Vite's CSS plugin emits the stylesheet as an asset and exports that asset's name. A dev
server leaves `?url` to Vite's asset plugin, which skips a module with no file behind it, so the stylesheet's CSS came
back as the module itself — a parse failure in the SSR runner, and a syntax error in the browser.

The dev server now exports the URL a `<link>` fetches the stylesheet from, behind the server's `origin` and `base`. That
request is served as CSS, and an edit reaches it the way it reaches an imported stylesheet.
