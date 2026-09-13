---
'@bamboocss/vite': patch
---

Keep the stylesheet hot-updating when something requests it before anything imports it, which TanStack Start does
whenever `__root.tsx` imports `virtual:bamboo.css` (#114).

An edit that added a style repainted the component with its new class, but the rule never arrived: the dev server kept
serving the previous stylesheet until a restart. Importing the stylesheet from `router.tsx` avoided it, at the cost of
server-rendered pages arriving unstyled in development.

The plugin registered every extracted file as a dependency of the stylesheet from `load`. Vite attaches those
registrations to the module's node in its graph, and a request for a module the graph has no node for yet runs `load`
first and creates the node afterwards, so the registrations were dropped and no edit propagated to the stylesheet in
that environment. A browser's own import never meets this, because the importer creates the node first. TanStack Start's
dev-only SSR style collection does: it requests the stylesheet from the client environment on the server, before the
browser has asked for it.

A dev server now registers the files from `transform`, where the node always exists. A build still registers them from
`load`, so `vite build --watch` is unchanged.

TanStack Start also has an installation guide now, covering where to import the stylesheet and why.
