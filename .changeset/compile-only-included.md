---
'@bamboocss/vite': patch
'@bamboocss/parser': patch
'@bamboocss/node': patch
---

Compile only the modules that can reach bamboo, and stop a bundler transform from invalidating every import resolution.

- A module `include` does not reach, or `exclude` drops, yields no stylesheet rule whatever it calls, so the compiler
  now leaves it alone — as it does a rewrite of an included module that a framework plugin hands over, such as the
  export-name stubs a router derives from its page modules. A module still compiles when it names a bamboo entrypoint,
  so the build-end check for classes without rules keeps reporting a misconfigured project, or when it imports a module
  the project holds, by relative path or through a package an included file already resolved.
- With the TypeScript 7 backend, each such module was parked in the shared project under an auxiliary path, and every
  file joining the project reloads the whole program in the Go compiler. A 7,000-file app whose config excludes 3,000
  generated GraphQL artifacts paid that reload 3,000 times per build environment, about a second each, and its
  production build stopped finishing inside a 30-minute CI timeout.
- An auxiliary source no longer counts as a change to the file tree: nothing imports `X.__bamboo__.tsx`, so no
  resolution can move. Every importer's cached import resolutions now survive it, where each one used to make every
  module parsed afterwards re-resolve its imports with filesystem probes.
