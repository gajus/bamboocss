---
'@bamboocss/vite': patch
---

Split the stylesheet per chunk only in an environment the browser loads, so a React Server Components app that loads a
server component with `import()` builds again. Under `@vitejs/plugin-rsc` the `rsc` environment writes the stylesheet,
and the split gave such a component's chunk a sheet of its utilities. Nothing in a server build links a chunk's sheet:
the plugin links the CSS of a module that imports CSS itself, and Bamboo's last check, made for the client environment,
found those rules missing from the entry sheet and failed the build. A server environment's sheet is now kept whole, as
`splitCss: false` kept it.
