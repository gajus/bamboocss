---
'@bamboocss/vite': patch
---

Keep the stylesheet whole in the server environment of `@vitejs/plugin-rsc`, so a React Server Components app that loads
a server component with `import()` builds again. That environment writes the stylesheet, and splitting it per chunk gave
such a component's chunk a sheet of its utilities, which the plugin links only for a module that imports CSS itself.
Bamboo's last check, made for the client environment, found those rules missing from the entry sheet and failed the
build. Other server environments are still split, for a framework such as Astro that links each chunk's sheets.
