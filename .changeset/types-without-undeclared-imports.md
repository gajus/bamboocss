---
'@bamboocss/types': patch
'@bamboocss/node': patch
---

Stop `@bamboocss/types` importing packages it does not depend on. Its declarations imported `TSConfig` from `pkg-types`
and `Difference` from `microdiff`, both only its devDependencies. A project type-checking them with `skipLibCheck` off
failed with "Cannot find module" unless its package manager happened to hoist both packages, and with `skipLibCheck` on
both types were `any`.

- Both types are now written out in the package. `DiffConfigResult['diffs']`, which the `config:change` hook receives,
  keeps `microdiff`'s shape.
- `TSConfig` types the two compiler options Bamboo reads, `baseUrl` and `paths`, and gives every other option the type
  `unknown`.
- `@bamboocss/node` no longer depends on `pkg-types`, which it listed only so that this import resolved.
