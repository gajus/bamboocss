---
'@bamboocss/config': patch
---

A config in a project that declares no aliases of its own loads through the `paths` of another the solution-style
`tsconfig.json` references. As `create vite` lays a project out, the config is in `tsconfig.node.json`, which declares
none, and a theme it imports through the app's `@/*` failed to load with `Could not resolve`. TypeScript fails that
import under `tsc -b` too, but the project has no alias of its own for the borrowed one to stand in for. A project that
declares aliases still resolves through those alone, as TypeScript does.
