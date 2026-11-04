---
'@bamboocss/node': patch
---

A Vue or Svelte component whose `<script lang="ts">` holds TypeScript that TSX cannot read, such as a generic arrow
`<T>(list: T[]) => list[0]` or an assertion `<boolean>value`, no longer fails the build. The component is read as TSX,
for the JSX a `lang="tsx"` script can hold, and the whole file failed to parse. A component that fails as TSX is now
read as TypeScript.
